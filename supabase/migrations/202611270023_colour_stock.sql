-- 202611270023_colour_stock.sql
-- Colour stock for individual sarees (POS <-> website sync).
--
-- One individual saree = one products row = ONE barcode and ONE price. Its physical pieces
-- can be split by colour, e.g. 10 pieces = 3 Green + 5 Red + 2 Violet. Pieces whose colour
-- has not been recorded yet are "undefined":
--
--     undefined pieces = products.stock_on_hand - sum(product_colours.quantity)
--
-- products.stock_on_hand / reserved remain the single stock ledger shared by the POS and the
-- website. Colour rows only split that ledger, so the two channels can never drift apart:
--   * the website sells a colour only when it is defined AND has a photo;
--   * an online order reserves that exact colour; paying for it removes that colour;
--   * a POS bill removes the colour the cashier picked after scanning (or undefined pieces);
--   * cancellations / returns put the piece back into the same colour.
-- A deferred check refuses any change that would leave more coloured pieces than stock.

create table if not exists public.product_colours (
 id uuid primary key default gen_random_uuid(),
 product_id uuid not null references public.products(id) on delete cascade,
 colour text not null check (length(btrim(colour)) between 1 and 50),
 colour_hex text not null default '' check (colour_hex = '' or colour_hex ~ '^#[0-9A-Fa-f]{6}$'),
 quantity int not null default 0 check (quantity between 0 and 100000),
 reserved int not null default 0 check (reserved >= 0 and reserved <= quantity),
 image_path text not null default '' check (length(image_path) <= 1000),
 sort_order int not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index if not exists product_colours_unique_name on public.product_colours(product_id, lower(btrim(colour)));
create index if not exists product_colours_product on public.product_colours(product_id, sort_order);

alter table public.product_colours enable row level security;
revoke all on public.product_colours from public, anon, authenticated;
grant all on public.product_colours to service_role;

-- Order lines remember the colour the customer bought.
alter table public.order_items add column if not exists colour_id uuid references public.product_colours(id) on delete set null;
alter table public.order_items add column if not exists colour text not null default '';
-- The same saree may now be ordered in two colours (two lines).
alter table public.order_items drop constraint if exists order_items_order_id_product_id_key;
create unique index if not exists order_items_order_product_colour on public.order_items(order_id, product_id, coalesce(colour_id::text, ''));

-- ---------------------------------------------------------------------------
-- Invariant: coloured pieces never exceed stock, coloured holds never exceed holds.
-- ---------------------------------------------------------------------------
create or replace function private.colour_stock_check() returns trigger language plpgsql security definer set search_path='' as $$
declare pid uuid; st int; rs int; q bigint; r bigint;
begin
 if tg_table_name = 'products' then pid := new.id; else pid := coalesce(new.product_id, old.product_id); end if;
 select stock_on_hand, reserved into st, rs from public.products where id = pid;
 if not found then return null; end if;
 select coalesce(sum(quantity), 0), coalesce(sum(reserved), 0) into q, r from public.product_colours where product_id = pid;
 if q > st then raise exception 'COLOUR_STOCK_EXCEEDS_TOTAL'; end if;
 if r > rs then raise exception 'COLOUR_RESERVED_MISMATCH'; end if;
 return null;
end $$;
drop trigger if exists colour_stock_check on public.product_colours;
create constraint trigger colour_stock_check after insert or update or delete on public.product_colours
 deferrable initially deferred for each row execute function private.colour_stock_check();
drop trigger if exists colour_stock_total_check on public.products;
create constraint trigger colour_stock_total_check after update of stock_on_hand, reserved on public.products
 deferrable initially deferred for each row execute function private.colour_stock_check();

-- Undefined pieces that are free to sell (not held by an older online order without a colour).
create or replace function private.undefined_available(p public.products) returns int language sql stable security definer set search_path='' as $$
 select (p.stock_on_hand - coalesce(sum(c.quantity), 0) - greatest(0, p.reserved - coalesce(sum(c.reserved), 0)))::int
 from public.product_colours c where c.product_id = p.id;
$$;

-- POS colour pick for one bill line. p_colours = [{colour_id: uuid|null, quantity}].
-- Pieces not given a colour are sold from undefined pieces. Returns the normalised allocation.
create or replace function private.colour_allocation(p public.products, p_qty int, p_colours jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare x jsonb; c public.product_colours; result jsonb := '[]'; total int := 0; undef int := 0; q int; cid uuid; seen uuid[] := '{}';
begin
 if p_colours is null or jsonb_typeof(p_colours) = 'null' then p_colours := '[]'; end if;
 if jsonb_typeof(p_colours) <> 'array' then raise exception 'INVALID_COLOUR_SELECTION'; end if;
 for x in select * from jsonb_array_elements(p_colours) loop
  if coalesce(x->>'quantity', '') !~ '^[0-9]{1,6}$' then raise exception 'INVALID_COLOUR_SELECTION'; end if;
  q := (x->>'quantity')::int;
  if q = 0 then continue; end if;
  total := total + q;
  if nullif(x->>'colour_id', '') is null then undef := undef + q; continue; end if;
  cid := (x->>'colour_id')::uuid;
  if cid = any(seen) then raise exception 'INVALID_COLOUR_SELECTION'; end if;
  seen := seen || cid;
  select * into c from public.product_colours where id = cid and product_id = p.id for update;
  if not found then raise exception 'COLOUR_UNAVAILABLE'; end if;
  if c.quantity - c.reserved < q then raise exception 'COLOUR_OUT_OF_STOCK'; end if;
  result := result || jsonb_build_array(jsonb_build_object('colour_id', c.id, 'colour', c.colour, 'quantity', q));
 end loop;
 if total > p_qty then raise exception 'INVALID_COLOUR_SELECTION'; end if;
 undef := undef + (p_qty - total);
 if undef > 0 then
  if private.undefined_available(p) < undef then raise exception 'COLOUR_REQUIRED'; end if;
  result := result || jsonb_build_array(jsonb_build_object('colour_id', null, 'colour', '', 'quantity', undef));
 end if;
 return result;
end $$;

-- Add (+1) or remove (-1) the pieces of an allocation from their colours.
-- A colour deleted in the meantime is skipped: those pieces stay undefined.
create or replace function private.colour_apply(p_alloc jsonb, p_sign int) returns void language plpgsql security definer set search_path='' as $$
declare x jsonb;
begin
 for x in select * from jsonb_array_elements(coalesce(p_alloc, '[]'::jsonb)) loop
  if nullif(x->>'colour_id', '') is not null and coalesce(x->>'quantity', '') ~ '^[0-9]+$' then
   update public.product_colours
      set quantity = greatest(reserved, quantity + p_sign * (x->>'quantity')::int), updated_at = now()
    where id = (x->>'colour_id')::uuid;
  end if;
 end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Admin: define the colour split of one saree (and optionally its total pieces).
-- p_rows = [{id?, colour, colour_hex, quantity, image_path, sort_order}]; rows left out are removed.
-- ---------------------------------------------------------------------------
create or replace function public.colour_stock_save(p_actor uuid, p_product uuid, p_rows jsonb, p_total int default null, p_reason text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.products; x jsonb; keep uuid[] := '{}'; rid uuid; q int; old public.product_colours; delta int; sumq bigint; names text[] := '{}'; nm text; summary text;
begin
 if not private.can_actor(p_actor, 'catalogue') then raise exception 'FORBIDDEN'; end if;
 select * into p from public.products where id = p_product for update;
 if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
 if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 60 then raise exception 'INVALID_COLOUR_SELECTION'; end if;

 -- 1. Total pieces (stock ledger) — only when it actually changes.
 if p_total is not null and p_total <> p.stock_on_hand then
  if not private.can_actor(p_actor, 'inventory') then raise exception 'FORBIDDEN'; end if;
  if p_total < 0 or p_total > 100000 then raise exception 'INVALID_QUANTITY'; end if;
  if p_total < p.reserved then raise exception 'STOCK_BELOW_RESERVED'; end if;
  delta := p_total - p.stock_on_hand;
  perform set_config('store.sale_id', '', true); perform set_config('store.order_id', '', true);
  perform set_config('store.purchase_id', '', true); perform set_config('store.unit_ids', '[]', true);
  update public.products set stock_on_hand = p_total, updated_at = now() where id = p_product;
  insert into public.inventory_movements(product_id, actor_id, delta, reason)
  values (p_product, p_actor, delta, coalesce(nullif(btrim(p_reason), ''), 'Colour stock edit'));
  select * into p from public.products where id = p_product;
 end if;

 -- 2. Validate names (unique per saree, case-insensitive).
 for x in select * from jsonb_array_elements(p_rows) loop
  nm := lower(btrim(coalesce(x->>'colour', '')));
  if nm = '' or length(nm) > 50 then raise exception 'INVALID_COLOUR_NAME'; end if;
  if nm in ('undefined', 'not defined', 'unknown') then raise exception 'INVALID_COLOUR_NAME'; end if;
  if nm = any(names) then raise exception 'DUPLICATE_COLOUR'; end if;
  names := names || nm;
  if coalesce(x->>'quantity', '') !~ '^[0-9]{1,6}$' then raise exception 'INVALID_QUANTITY'; end if;
  if nullif(x->>'id', '') is not null then keep := keep || (x->>'id')::uuid; end if;
 end loop;

 -- 3. Remove colours that were left out (never one an online order is holding).
 if exists(select 1 from public.product_colours where product_id = p_product and not (id = any(keep)) and reserved > 0) then
  raise exception 'COLOUR_HAS_RESERVATIONS';
 end if;
 delete from public.product_colours where product_id = p_product and not (id = any(keep));

 -- 4. Update existing colours, insert new ones (the totals check below runs after all rows).
 for x in select * from jsonb_array_elements(p_rows) loop
  q := (x->>'quantity')::int;
  rid := nullif(x->>'id', '')::uuid;
  if rid is not null then
   select * into old from public.product_colours where id = rid and product_id = p_product for update;
   if not found then raise exception 'COLOUR_UNAVAILABLE'; end if;
   if q < old.reserved then raise exception 'COLOUR_BELOW_RESERVED'; end if;
   update public.product_colours set
     colour = left(btrim(x->>'colour'), 50),
     colour_hex = coalesce(nullif(x->>'colour_hex', ''), ''),
     quantity = q,
     image_path = left(coalesce(x->>'image_path', ''), 1000),
     sort_order = coalesce(nullif(x->>'sort_order', '')::int, 0),
     updated_at = now()
   where id = rid;
  else
   insert into public.product_colours(product_id, colour, colour_hex, quantity, image_path, sort_order)
   values (p_product, left(btrim(x->>'colour'), 50), coalesce(nullif(x->>'colour_hex', ''), ''), q,
           left(coalesce(x->>'image_path', ''), 1000), coalesce(nullif(x->>'sort_order', '')::int, 0));
  end if;
 end loop;

 select coalesce(sum(quantity), 0) into sumq from public.product_colours where product_id = p_product;
 if sumq > p.stock_on_hand then raise exception 'COLOUR_STOCK_EXCEEDS_TOTAL'; end if;

 -- Keep products.colour as a readable summary for search / filters.
 select coalesce(string_agg(colour, ', ' order by sort_order, lower(colour)), '') into summary from public.product_colours where product_id = p_product;
 update public.products set colour = left(summary, 120), updated_at = now() where id = p_product;

 perform private.audit(p_actor, 'colours.saved', 'products', p_product::text, jsonb_build_object('rows', p_rows, 'total', p.stock_on_hand));
 return jsonb_build_object('stock_on_hand', p.stock_on_hand, 'coloured', sumq, 'undefined', p.stock_on_hand - sumq);
end $$;

-- ---------------------------------------------------------------------------
-- Online checkout: every line names a colour that is defined and has a photo.
-- Cart line: {product_id, quantity, colour_id}. The same saree may appear once per colour.
-- ---------------------------------------------------------------------------
create or replace function public.create_checkout(
  p_customer uuid, p_key uuid, p_cart jsonb, p_address jsonb, p_channel text, p_coupon text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  s public.store_settings; o public.orders; pr public.products; c public.product_colours; off public.offers; cand public.offers;
  line record; fingerprint text; oid uuid := gen_random_uuid();
  subtotal bigint := 0; discount bigint := 0; shipping int; tax bigint; unit int; total bigint; selected_offer uuid; d bigint;
begin
  perform pg_advisory_xact_lock_shared(761117030);
  if not exists(select 1 from public.profiles where id = p_customer and not suspended) then raise exception 'ACCOUNT_DISABLED'; end if;
  select * into s from public.store_settings where id;
  if not s.ordering_enabled then raise exception 'ORDERING_DISABLED'; end if;
  if p_channel not in ('whatsapp', 'upi', 'razorpay') then raise exception 'INVALID_CHANNEL'; end if;
  if (p_channel = 'whatsapp' and s.checkout_mode = 'online_only') or
     (p_channel <> 'whatsapp' and s.checkout_mode = 'whatsapp_only') or
     (p_channel = 'upi' and s.online_method <> 'manual_upi' and s.online_method <> 'razorpay_upi' and coalesce(s.upi_id, '') = '') or
     (p_channel = 'razorpay' and s.online_method <> 'razorpay_upi') then
    raise exception 'CHANNEL_DISABLED';
  end if;
  if jsonb_typeof(p_cart) <> 'array' or jsonb_array_length(p_cart) not between 1 and 20 then raise exception 'INVALID_CART'; end if;
  if jsonb_typeof(p_address) <> 'object' or length(coalesce(p_address->>'name', '')) < 2 or length(coalesce(p_address->>'phone', '')) < 7 or
     length(coalesce(p_address->>'line1', '')) < 4 or coalesce(p_address->>'pin', '') !~ '^[1-9][0-9]{5}$' then
    raise exception 'INVALID_ADDRESS';
  end if;

  fingerprint := encode(sha256(convert_to(p_cart::text || p_address::text || p_channel || coalesce(p_coupon, ''), 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtext(p_customer::text));
  select * into o from public.orders where customer_id = p_customer and checkout_key = p_key;
  if found then
    if o.request_hash <> fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return o.id;
  end if;
  if (select count(*) from public.orders where customer_id = p_customer and stock_state = 'reserved') >= 10 then raise exception 'TOO_MANY_PENDING_ORDERS'; end if;
  if exists(select 1 from jsonb_array_elements(p_cart) x where jsonb_typeof(x->'quantity') <> 'number' or (x->>'quantity') !~ '^[0-9]+$' or (x->>'quantity')::numeric not between 1 and 20) then
    raise exception 'INVALID_QUANTITY';
  end if;
  if exists(select 1 from jsonb_array_elements(p_cart) x where coalesce(x->>'colour_id', '') !~ '^[0-9a-fA-F-]{36}$') then raise exception 'COLOUR_REQUIRED'; end if;
  if (select count(distinct (x->>'product_id') || ':' || (x->>'colour_id')) from jsonb_array_elements(p_cart) x) <> jsonb_array_length(p_cart) then raise exception 'DUPLICATE_ITEM'; end if;
  if p_coupon is not null and trim(p_coupon) <> '' then
    select * into off from public.offers where code = upper(trim(p_coupon)) for update;
    if not found then raise exception 'INVALID_COUPON'; end if;
  end if;

  for line in select (x->>'product_id')::uuid pid, (x->>'colour_id')::uuid cid, (x->>'quantity')::int qty
              from jsonb_array_elements(p_cart) x order by (x->>'product_id')::uuid, (x->>'colour_id')::uuid loop
    select * into pr from public.products where id = line.pid for update;
    if not found or not pr.published or not private.product_visible(pr) then raise exception 'PRODUCT_UNAVAILABLE'; end if;
    if pr.price_paise <= 0 then raise exception 'PRICE_NOT_SET'; end if;
    select * into c from public.product_colours where id = line.cid and product_id = pr.id for update;
    if not found or c.image_path = '' then raise exception 'COLOUR_UNAVAILABLE'; end if;
    if c.quantity - c.reserved < line.qty or pr.stock_on_hand - pr.reserved < line.qty then raise exception 'OUT_OF_STOCK'; end if;
    unit := private.product_price(pr);
    subtotal := subtotal + unit::bigint * line.qty;
  end loop;

  if p_coupon is not null and trim(p_coupon) <> '' then
    d := private.offer_discount(off, p_cart, subtotal, p_customer);
    if d <= 0 then raise exception 'COUPON_NOT_ELIGIBLE'; end if;
    selected_offer := off.id; discount := d;
  else
    for cand in select * from public.offers where code is null and active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()) and (max_uses is null or used_count < max_uses) order by priority desc, id for update loop
      d := private.offer_discount(cand, p_cart, subtotal, p_customer);
      if d > discount then discount := d; selected_offer := cand.id; end if;
    end loop;
  end if;
  if selected_offer is not null then update public.offers set used_count = used_count + 1 where id = selected_offer; end if;

  shipping := case when s.free_shipping_above_paise > 0 and subtotal - discount >= s.free_shipping_above_paise then 0 else s.shipping_paise end;
  tax := round((subtotal - discount)::numeric * s.tax_bps / 10000)::bigint;
  total := subtotal - discount + shipping + tax;
  if total <= 0 or total > 2000000000 then raise exception 'INVALID_ORDER_TOTAL'; end if;

  insert into public.orders(id, customer_id, checkout_key, request_hash, channel, address, customer_phone,
    subtotal_paise, discount_paise, shipping_paise, tax_paise, total_paise, offer_id, coupon_counted, expires_at)
  values (oid, p_customer, p_key, fingerprint, p_channel, p_address, coalesce(p_address->>'phone', ''),
    subtotal, discount, shipping, tax, total, selected_offer, selected_offer is not null, now() + make_interval(mins => s.reservation_minutes));

  for line in select (x->>'product_id')::uuid pid, (x->>'colour_id')::uuid cid, (x->>'quantity')::int qty
              from jsonb_array_elements(p_cart) x order by (x->>'product_id')::uuid, (x->>'colour_id')::uuid loop
    select * into pr from public.products where id = line.pid;
    select * into c from public.product_colours where id = line.cid;
    unit := private.product_price(pr);
    insert into public.order_items(order_id, product_id, name, image_path, quantity, unit_price_paise, list_price_paise, line_total_paise, colour_id, colour)
    values (oid, pr.id, pr.name, coalesce(nullif(c.image_path, ''), pr.image_path), line.qty, unit, pr.price_paise, unit::bigint * line.qty, c.id, c.colour);
    update public.products set reserved = reserved + line.qty where id = pr.id;
    update public.product_colours set reserved = reserved + line.qty, updated_at = now() where id = c.id;
  end loop;

  insert into public.order_events(order_id, actor_id, message) values (oid, p_customer, 'Order created. Waiting for payment.');
  perform private.notify(oid, 'Order received', 'Your order was saved. Complete your selected payment step.');
  return oid;
end $$;

create or replace function private.release_stock(p_order uuid) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders; line record;
begin
 select * into o from public.orders where id = p_order for update;
 if o.stock_state <> 'reserved' then return; end if;
 if o.coupon_counted then perform 1 from public.offers where id = o.offer_id for update; end if;
 for line in select * from public.order_items where order_id = p_order order by product_id, colour_id loop
   perform 1 from public.products where id = line.product_id for update;
   update public.products set reserved = reserved - line.quantity where id = line.product_id;
   if line.colour_id is not null then
     update public.product_colours set reserved = greatest(0, reserved - line.quantity), updated_at = now() where id = line.colour_id;
   end if;
 end loop;
 update public.orders set stock_state = 'released', coupon_counted = false where id = p_order;
 if o.coupon_counted then update public.offers set used_count = greatest(0, used_count - 1) where id = o.offer_id; end if;
end $$;

create or replace function public.record_payment(p_order uuid, p_event text, p_payment text, p_amount bigint, p_currency text, p_method text, p_actor uuid default null, p_reference text default null) returns text language plpgsql security definer set search_path='' as $$
declare o public.orders; line record; manual boolean := p_actor is not null;
begin
 if manual and not private.can_actor(p_actor, 'payments') then raise exception 'FORBIDDEN'; end if;
 select * into o from public.orders where id = p_order for update;
 if not found then raise exception 'ORDER_NOT_FOUND'; end if;
 if p_amount <> o.total_paise or p_currency <> 'INR' then raise exception 'PAYMENT_MISMATCH'; end if;
 if manual and o.channel = 'razorpay' then raise exception 'GATEWAY_VERIFICATION_REQUIRED'; end if;
 if not manual and (o.channel <> 'razorpay' or p_method <> 'upi') then raise exception 'PAYMENT_METHOD_MISMATCH'; end if;
 if manual and length(coalesce(p_reference, '')) < 6 then raise exception 'PAYMENT_REFERENCE_REQUIRED'; end if;
 insert into private.payment_events(event_id) values (p_event) on conflict do nothing;
 if not found then return o.payment_status; end if;
 if o.payment_status in ('paid', 'refund_pending', 'refunded', 'late_paid') then return o.payment_status; end if;
 if o.stock_state <> 'reserved' or o.expires_at <= now() then
   perform private.release_stock(p_order);
   update public.orders set status = 'review_required', payment_status = 'late_paid', provider_payment_id = case when manual then null else p_payment end, payment_reference = p_reference, paid_at = now(), updated_at = now() where id = p_order;
   insert into public.order_events(order_id, actor_id, message) values (p_order, p_actor, 'Payment arrived after the reservation ended. Staff will review and arrange a refund.');
   perform private.notify(p_order, 'Payment needs review', 'Your payment arrived after the stock hold ended. Please contact the store.');
   return 'late_paid';
 end if;
 perform set_config('store.order_id', p_order::text, true); perform set_config('store.sale_id', '', true);
 perform set_config('store.purchase_id', '', true); perform set_config('store.unit_ids', '[]', true);
 for line in select * from public.order_items where order_id = p_order order by product_id, colour_id loop
   perform 1 from public.products where id = line.product_id for update;
   if line.colour_id is not null then
     update public.product_colours set quantity = quantity - line.quantity, reserved = reserved - line.quantity, updated_at = now() where id = line.colour_id;
   end if;
   update public.products set stock_on_hand = stock_on_hand - line.quantity, reserved = reserved - line.quantity where id = line.product_id;
   insert into public.inventory_movements(product_id, actor_id, order_id, delta, reason)
   values (line.product_id, p_actor, p_order, -line.quantity, 'Paid order' || case when line.colour <> '' then ' (' || line.colour || ')' else '' end);
 end loop;
 update public.orders set payment_status = 'paid', status = 'confirmed', stock_state = 'consumed', provider_payment_id = case when manual then null else p_payment end, payment_reference = p_reference, paid_at = now(), updated_at = now() where id = p_order;
 insert into public.order_events(order_id, actor_id, message) values (p_order, p_actor, 'Payment checked. Order confirmed.');
 perform private.audit(p_actor, 'payment.confirmed', 'orders', p_order::text, jsonb_build_object('manual', manual));
 perform private.notify(p_order, 'Order confirmed', 'Your payment is confirmed. We will prepare your sarees.');
 return 'paid';
end $$;

create or replace function public.change_order_status(p_actor uuid, p_order uuid, p_status text, p_note text default '') returns void language plpgsql security definer set search_path='' as $$
declare o public.orders; line record;
begin
 select * into o from public.orders where id = p_order for update;
 if not found then raise exception 'ORDER_NOT_FOUND'; end if;
 if not private.can_actor(p_actor, 'orders') then
   if o.customer_id <> p_actor or not ((p_status = 'cancelled' and o.status = 'awaiting_payment') or (p_status = 'return_requested' and o.status = 'delivered')) then raise exception 'FORBIDDEN'; end if;
 end if;
 perform set_config('store.order_id', p_order::text, true); perform set_config('store.sale_id', '', true);
 perform set_config('store.purchase_id', '', true); perform set_config('store.unit_ids', '[]', true);
 if p_status = 'cancelled' and o.status in ('awaiting_payment', 'confirmed', 'packing') then
   if o.stock_state = 'reserved' then perform private.release_stock(p_order);
   elsif o.stock_state = 'consumed' then
     for line in select * from public.order_items where order_id = p_order order by product_id, colour_id loop
       perform 1 from public.products where id = line.product_id for update;
       update public.products set stock_on_hand = stock_on_hand + line.quantity where id = line.product_id;
       if line.colour_id is not null then
         update public.product_colours set quantity = quantity + line.quantity, updated_at = now() where id = line.colour_id;
       end if;
       insert into public.inventory_movements(product_id, actor_id, order_id, delta, reason) values (line.product_id, p_actor, p_order, line.quantity, 'Cancelled before shipping');
     end loop;
     update public.orders set stock_state = 'released' where id = p_order;
   end if;
   if o.payment_status = 'paid' then update public.orders set payment_status = 'refund_pending' where id = p_order; end if;
 elsif p_status = 'packing' and o.status = 'confirmed' and o.payment_status = 'paid' then null;
 elsif p_status = 'shipped' and o.status = 'packing' and o.payment_status = 'paid' and o.tracking_id <> '' then null;
 elsif p_status = 'delivered' and o.status = 'shipped' and o.payment_status = 'paid' then null;
 elsif p_status = 'return_requested' and o.status = 'delivered' then null;
 elsif p_status = 'returned' and o.status = 'return_requested' and o.stock_state = 'consumed' and length(trim(p_note)) >= 3 then
   for line in select * from public.order_items where order_id = p_order order by product_id, colour_id loop
     perform 1 from public.products where id = line.product_id for update;
     update public.products set stock_on_hand = stock_on_hand + line.quantity where id = line.product_id;
     if line.colour_id is not null then
       update public.product_colours set quantity = quantity + line.quantity, updated_at = now() where id = line.colour_id;
     end if;
     insert into public.inventory_movements(product_id, actor_id, order_id, delta, reason) values (line.product_id, p_actor, p_order, line.quantity, 'Return received: ' || p_note);
   end loop;
   update public.orders set stock_state = 'released', payment_status = 'refund_pending' where id = p_order;
 else raise exception 'INVALID_STATUS_CHANGE'; end if;
 update public.orders set status = p_status, updated_at = now() where id = p_order;
 insert into public.order_events(order_id, actor_id, message)
 values (p_order, p_actor, 'Order status: ' || case p_status when 'packing' then 'packed' when 'shipped' then 'dispatched' else replace(p_status, '_', ' ') end || case when p_note <> '' then '. ' || p_note else '' end);
 perform private.audit(p_actor, 'order.status', 'orders', p_order::text, jsonb_build_object('status', p_status));
 perform private.notify(p_order, 'Order update', 'Your order status is now ' || case p_status when 'packing' then 'packed' when 'shipped' then 'dispatched' else replace(p_status, '_', ' ') end || '.');
end $$;

-- ---------------------------------------------------------------------------
-- POS: one bill line per saree; the line says which colours were billed.
-- Cart line: {product_id, quantity, unit_ids, colours: [{colour_id|null, quantity}]}.
-- ---------------------------------------------------------------------------
create or replace function public.pos_quote(p_actor uuid, p_cart jsonb, p_discount bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.pos_settings; p public.products; x jsonb; items jsonb := '[]'; subtotal bigint := 0; tax bigint; unit int; qty int; offer_title text; offer_paise bigint := 0; cand public.offers; d bigint; alloc jsonb;
begin
 if not private.can_actor(p_actor, 'pos') then raise exception 'FORBIDDEN'; end if;
 select * into s from public.pos_settings where id; if not s.enabled then raise exception 'POS_DISABLED'; end if;
 if jsonb_typeof(p_cart) <> 'array' or jsonb_array_length(p_cart) not between 1 and 100 or (select count(distinct value->>'product_id') from jsonb_array_elements(p_cart)) <> jsonb_array_length(p_cart) then raise exception 'INVALID_CART'; end if;
 for x in select * from jsonb_array_elements(p_cart) loop
  qty := (x->>'quantity')::int; if qty not between 1 and 100 or qty is null then raise exception 'INVALID_QUANTITY'; end if;
  select * into p from public.products where id = (x->>'product_id')::uuid;
  if not found or not private.product_visible(p) or p.price_paise <= 0 then raise exception 'PRODUCT_UNAVAILABLE'; end if;
  if p.stock_on_hand - p.reserved < qty then raise exception 'OUT_OF_STOCK'; end if;
  if coalesce(jsonb_array_length(x->'unit_ids'), 0) > 0 and (jsonb_array_length(x->'unit_ids') <> qty or (select count(distinct u.id) from public.product_units u where u.product_id = p.id and u.state = 'in_stock' and u.id in (select value::bigint from jsonb_array_elements_text(x->'unit_ids'))) <> qty) then raise exception 'UNIT_UNAVAILABLE'; end if;
  alloc := private.colour_allocation(p, qty, x->'colours');
  unit := private.product_price(p); subtotal := subtotal + unit::bigint * qty;
  items := items || jsonb_build_array(jsonb_build_object('product_id', p.id, 'name', p.name, 'sku', p.sku, 'quantity', qty, 'unit_paise', unit, 'line_paise', unit::bigint * qty, 'colours', alloc));
 end loop;
 if p_discount < 0 or p_discount > floor(subtotal::numeric * s.max_discount_bps / 10000) then raise exception 'DISCOUNT_LIMIT'; end if;
 for cand in select * from public.offers where code is null and active and apply_in_pos and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()) and (max_uses is null or used_count < max_uses) order by priority desc, id loop
  d := private.offer_discount(cand, p_cart, subtotal, null);
  if d > offer_paise then offer_paise := d; offer_title := cand.title; end if;
 end loop;
 if p_discount + offer_paise >= subtotal then raise exception 'INVALID_ORDER_TOTAL'; end if;
 tax := round((subtotal - offer_paise - p_discount)::numeric * s.tax_bps / 10000)::bigint;
 return jsonb_build_object('items', items, 'subtotal_paise', subtotal, 'discount_paise', p_discount, 'offer_discount_paise', offer_paise, 'offer_title', offer_title, 'tax_paise', tax, 'total_paise', subtotal - offer_paise - p_discount + tax, 'max_discount_paise', floor(subtotal::numeric * s.max_discount_bps / 10000));
end $$;

create or replace function public.pos_checkout(p_actor uuid, p_key uuid, p_cart jsonb, p_customer jsonb, p_discount bigint, p_tenders jsonb, p_cash_received bigint, p_bank_checked boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.pos_settings; pr public.products; o public.pos_sales; line record; t jsonb; items jsonb := '[]'; subtotal bigint := 0; tax bigint; total bigint; tender_total bigint := 0; cash bigint := 0; unit int; fingerprint text; offer_id uuid; offer_title text; offer_paise bigint := 0; cand public.offers; d bigint; key uuid := gen_random_uuid(); serial bigint; inv text; alloc jsonb;
begin
 if not private.can_actor(p_actor, 'pos') then raise exception 'FORBIDDEN'; end if;
 fingerprint := encode(sha256(convert_to(p_cart::text || p_customer::text || p_discount::text || p_tenders::text || p_cash_received::text || p_bank_checked::text, 'UTF8')), 'hex');
 perform pg_advisory_xact_lock(hashtext('pos:' || p_actor::text));
 select * into o from public.pos_sales where cashier_id = p_actor and request_key = p_key;
 if found then if o.request_hash <> fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return o.id; end if;
 select * into s from public.pos_settings where id;
 if not s.enabled then raise exception 'POS_DISABLED'; end if;
 if jsonb_typeof(p_cart) <> 'array' or jsonb_array_length(p_cart) not between 1 and 100 then raise exception 'INVALID_CART'; end if;
 if length(coalesce(p_customer->>'name', '')) > 80 or length(coalesce(p_customer->>'phone', '')) > 25 then raise exception 'INVALID_CUSTOMER'; end if;
 if (select count(distinct x->>'product_id') from jsonb_array_elements(p_cart) x) <> jsonb_array_length(p_cart) then raise exception 'DUPLICATE_ITEM'; end if;
 for line in select (x->>'product_id')::uuid pid, (x->>'quantity')::numeric qty, x->'unit_ids' units, x->'colours' colours from jsonb_array_elements(p_cart) x order by (x->>'product_id')::uuid loop
  if line.qty is null or line.qty <> trunc(line.qty) or line.qty not between 1 and 100 then raise exception 'INVALID_QUANTITY'; end if;
  select * into pr from public.products where id = line.pid for update;
  if not found or not private.product_visible(pr) then raise exception 'PRODUCT_UNAVAILABLE'; end if;
  if pr.price_paise <= 0 then raise exception 'PRICE_NOT_SET'; end if;
  if pr.stock_on_hand - pr.reserved < line.qty then raise exception 'OUT_OF_STOCK'; end if;
  if line.units is not null and (jsonb_typeof(line.units) <> 'array' or jsonb_array_length(line.units) not in (0, line.qty::int)) then raise exception 'BARCODE_QUANTITY_MISMATCH'; end if;
  if coalesce(jsonb_array_length(line.units), 0) > 0 and (select count(distinct u.id) from public.product_units u where u.product_id = pr.id and u.state = 'in_stock' and u.id in (select value::bigint from jsonb_array_elements_text(line.units))) <> line.qty then raise exception 'UNIT_UNAVAILABLE'; end if;
  alloc := private.colour_allocation(pr, line.qty::int, line.colours);
  unit := private.product_price(pr);
  subtotal := subtotal + unit::bigint * line.qty::int;
  items := items || jsonb_build_array(jsonb_build_object('product_id', pr.id, 'sku', pr.sku, 'barcode', pr.barcode, 'name', pr.name, 'quantity', line.qty::int, 'unit_paise', unit, 'line_paise', unit::bigint * line.qty::int, 'unit_ids', coalesce(line.units, '[]'), 'colours', alloc));
 end loop;
 for cand in select * from public.offers where code is null and active and apply_in_pos and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()) and (max_uses is null or used_count < max_uses) order by priority desc, id for update loop
  d := private.offer_discount(cand, p_cart, subtotal, null);
  if d > offer_paise then offer_paise := d; offer_id := cand.id; offer_title := cand.title; end if;
 end loop;
 if p_discount > 0 and length(trim(coalesce(p_customer->>'discount_reason', ''))) < 3 then raise exception 'DISCOUNT_REASON_REQUIRED'; end if;
 if p_discount < 0 or p_discount > floor(subtotal::numeric * s.max_discount_bps / 10000) then raise exception 'DISCOUNT_LIMIT'; end if;
 if p_discount + offer_paise >= subtotal then raise exception 'INVALID_ORDER_TOTAL'; end if;
 tax := round((subtotal - offer_paise - p_discount)::numeric * s.tax_bps / 10000)::bigint; total := subtotal - offer_paise - p_discount + tax;
 if total <= 0 or total > 2000000000 then raise exception 'INVALID_ORDER_TOTAL'; end if;
 if jsonb_typeof(p_tenders) <> 'array' or jsonb_array_length(p_tenders) not between 1 and 3 then raise exception 'INVALID_TENDER'; end if;
 if (select count(distinct x->>'method') from jsonb_array_elements(p_tenders) x) <> jsonb_array_length(p_tenders) then raise exception 'INVALID_TENDER'; end if;
 for t in select * from jsonb_array_elements(p_tenders) loop
  if coalesce(t->>'method', '') not in ('cash', 'upi', 'card') or coalesce(t->>'amount_paise', '') !~ '^[0-9]+$' or (t->>'amount_paise')::numeric not between 1 and 2000000000 then raise exception 'INVALID_TENDER'; end if;
  if t->>'method' <> 'cash' and (not p_bank_checked or length(coalesce(t->>'reference', '')) not between 6 and 100) then raise exception 'BANK_CHECK_REQUIRED'; end if;
  tender_total := tender_total + (t->>'amount_paise')::bigint;
  if t->>'method' = 'cash' then cash := cash + (t->>'amount_paise')::bigint; end if;
 end loop;
 if tender_total <> total or p_cash_received < cash or (cash = 0 and p_cash_received <> 0) then raise exception 'TENDER_MISMATCH'; end if;
 serial := nextval(pg_get_serial_sequence('public.pos_sales', 'number')); inv := s.invoice_prefix || '-' || lpad(serial::text, 6, '0');
 insert into public.pos_sales(id, number, cashier_id, request_key, request_hash, invoice_no, customer_name, customer_phone, business, items, tenders, subtotal_paise, discount_paise, tax_paise, total_paise, cash_received_paise, change_paise)
 overriding system value values (key, serial, p_actor, p_key, fingerprint, inv, coalesce(p_customer->>'name', ''), coalesce(p_customer->>'phone', ''), to_jsonb(s) - 'enabled' - 'max_discount_bps', items, p_tenders, subtotal, offer_paise + p_discount, tax, total, p_cash_received, p_cash_received - cash);
 if offer_id is not null then update public.offers set used_count = used_count + 1 where id = offer_id; end if;
 perform set_config('store.sale_id', key::text, true); perform set_config('store.order_id', '', true); perform set_config('store.purchase_id', '', true);
 for line in select * from jsonb_to_recordset(items) as x(product_id uuid, quantity int, unit_ids jsonb, colours jsonb) order by product_id loop
  perform set_config('store.unit_ids', line.unit_ids::text, true);
  perform private.colour_apply(line.colours, -1);
  update public.products set stock_on_hand = stock_on_hand - line.quantity, updated_at = now() where id = line.product_id;
  insert into public.inventory_movements(product_id, actor_id, delta, reason)
  values (line.product_id, p_actor, -line.quantity, 'POS sale ' || inv || coalesce(' (' || nullif((select string_agg(case when c->>'colour' = '' then 'Undefined' else c->>'colour' end || ' x' || (c->>'quantity'), ', ') from jsonb_array_elements(line.colours) c), '') || ')', ''));
 end loop;
 update public.pos_sales set discount_reason = coalesce(p_customer->>'discount_reason', ''), pricing_snapshot = jsonb_build_object('catalogue_prices', pos_sales.items, 'walkin_discount_paise', p_discount, 'offer_id', offer_id, 'offer_title', offer_title, 'offer_discount_paise', offer_paise, 'max_discount_bps', s.max_discount_bps) where id = key;
 perform private.audit(p_actor, 'pos.completed', 'pos_sales', key::text, jsonb_build_object('invoice', inv, 'total_paise', total)); return key;
end $$;

create or replace function public.pos_return(p_actor uuid, p_sale uuid, p_reason text, p_reference text) returns void language plpgsql security definer set search_path='' as $$
declare o public.pos_sales; line record;
begin
 if not private.can_actor(p_actor, 'pos') or not private.can_actor(p_actor, 'inventory') then raise exception 'FORBIDDEN'; end if;
 select * into o from public.pos_sales where id = p_sale for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if o.status = 'returned' then return; end if;
 if length(trim(p_reason)) not between 3 and 500 or length(trim(p_reference)) not between 6 and 100 then raise exception 'RETURN_DETAILS_REQUIRED'; end if;
 perform set_config('store.sale_id', p_sale::text, true); perform set_config('store.order_id', '', true);
 perform set_config('store.purchase_id', '', true); perform set_config('store.unit_ids', '[]', true);
 for line in select * from jsonb_to_recordset(o.items) as x(product_id uuid, quantity int, colours jsonb) order by product_id loop
  perform 1 from public.products where id = line.product_id for update;
  update public.products set stock_on_hand = stock_on_hand + line.quantity, updated_at = now() where id = line.product_id;
  perform private.colour_apply(line.colours, 1);
  insert into public.inventory_movements(product_id, actor_id, delta, reason) values (line.product_id, p_actor, line.quantity, 'POS full return ' || o.invoice_no);
 end loop;
 update public.pos_sales set status = 'returned', returned_by = p_actor, return_note = p_reason, refund_reference = p_reference, returned_at = now() where id = p_sale;
 perform private.audit(p_actor, 'pos.returned', 'pos_sales', p_sale::text, jsonb_build_object('reason', p_reason, 'reference', p_reference));
end $$;

-- ---------------------------------------------------------------------------
-- Catalogue view: colours, undefined pieces and what the website can sell.
-- ---------------------------------------------------------------------------
drop view if exists public.store_catalogue;
create view public.store_catalogue with (security_invoker = true) as
 select p.*,
  private.product_price(p) as effective_price_paise,
  s.name as subcategory_name, m.id as category_id, m.name as category_name,
  private.product_visible(p) as category_visible,
  coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'colour', c.colour, 'colour_hex', c.colour_hex, 'quantity', c.quantity,
            'reserved', c.reserved, 'image_path', c.image_path, 'sort_order', c.sort_order) order by c.sort_order, lower(c.colour))
            from public.product_colours c where c.product_id = p.id), '[]'::jsonb) as colours,
  (p.stock_on_hand - coalesce((select sum(c.quantity) from public.product_colours c where c.product_id = p.id), 0))::int as undefined_quantity,
  least(greatest(p.stock_on_hand - p.reserved, 0),
        coalesce((select sum(greatest(c.quantity - c.reserved, 0)) from public.product_colours c where c.product_id = p.id and c.image_path <> ''), 0))::int as online_available,
  exists(select 1 from public.product_colours c where c.product_id = p.id and c.image_path <> '') as online_ready
 from public.products p
 left join public.product_categories s on s.id = p.subcategory_id
 left join public.product_categories m on m.id = s.parent_id;
revoke all on public.store_catalogue from public, anon, authenticated;
grant select on public.store_catalogue to service_role;

-- ---------------------------------------------------------------------------
-- Existing single-colour sarees keep selling online: their colour becomes a colour row.
-- Pieces held by older pending orders stay undefined until those orders settle.
-- ---------------------------------------------------------------------------
insert into public.product_colours(product_id, colour, quantity, image_path)
select p.id, left(btrim(p.colour), 50), greatest(p.stock_on_hand - p.reserved, 0), coalesce(p.image_path, '')
from public.products p
where not p.archived
  and btrim(coalesce(p.colour, '')) <> ''
  and lower(btrim(p.colour)) not in ('undefined', 'not defined', 'unknown', 'standard', 'mixed', 'multi', 'multi colour', 'multicolour', 'assorted')
  and not exists(select 1 from public.product_colours c where c.product_id = p.id);

-- ---------------------------------------------------------------------------
-- Customisable WhatsApp messages (POS bill, online order, dispatch).
-- Placeholders: {customer_name} {store_name} {invoice_no} {order_no} {total} {items} {date}
--               {courier} {tracking_id} {tracking_link} {store_phone}
-- ---------------------------------------------------------------------------
create table if not exists public.message_templates (
 key text primary key check (key ~ '^[a-z_]{3,40}$'),
 body text not null check (length(body) between 1 and 2000),
 enabled boolean not null default true,
 updated_by uuid,
 updated_at timestamptz not null default now()
);
alter table public.message_templates enable row level security;
revoke all on public.message_templates from public, anon, authenticated;
grant all on public.message_templates to service_role;
insert into public.message_templates(key, body) values
 ('pos_bill_whatsapp', E'Vanakkam {customer_name} 🙏\n\nThank you for shopping with {store_name}! Your bill *{invoice_no}* dated {date} comes to *{total}*.\n\n{items}\n\nWe hope you love wearing it. Please visit us again 💐\n{store_phone}'),
 ('order_whatsapp', E'Vanakkam {customer_name} 🙏\n\nThank you for your order *#{order_no}* with {store_name}. Order total: *{total}*.\n\n{items}\n\nWe will keep you updated at every step 💐'),
 ('order_dispatched_whatsapp', E'Vanakkam {customer_name} 🙏\n\nGood news! Your {store_name} order *#{order_no}* has been dispatched via {courier}.\nTracking ID: {tracking_id}\nTrack here: {tracking_link}\n\nThank you for shopping with us 💐')
on conflict (key) do nothing;

revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.colour_stock_save(uuid, uuid, jsonb, int, text) from public, anon, authenticated;
grant execute on function public.colour_stock_save(uuid, uuid, jsonb, int, text) to service_role;
revoke all on function public.create_checkout(uuid, uuid, jsonb, jsonb, text, text), public.record_payment(uuid, text, text, bigint, text, text, uuid, text),
  public.change_order_status(uuid, uuid, text, text), public.pos_quote(uuid, jsonb, bigint),
  public.pos_checkout(uuid, uuid, jsonb, jsonb, bigint, jsonb, bigint, boolean), public.pos_return(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_checkout(uuid, uuid, jsonb, jsonb, text, text), public.record_payment(uuid, text, text, bigint, text, text, uuid, text),
  public.change_order_status(uuid, uuid, text, text), public.pos_quote(uuid, jsonb, bigint),
  public.pos_checkout(uuid, uuid, jsonb, jsonb, bigint, jsonb, bigint, boolean), public.pos_return(uuid, uuid, text, text) to service_role;
