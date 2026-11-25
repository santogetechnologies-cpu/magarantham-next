-- 202611250018_order_flow_piece_tracking.sql
-- Enable online ordering, configure checkout channels, add piece tracking to order_items,
-- and ensure create_checkout never blocks valid orders.

-- 1. Ensure store settings have ordering enabled and both channels available
update public.store_settings
set ordering_enabled = true,
    checkout_mode = 'both',
    whatsapp_phone = case when coalesce(whatsapp_phone, '') = '' then '+919876543210' else whatsapp_phone end
where id = true;

-- 2. Add physical saree piece tracking columns to order_items
alter table public.order_items add column if not exists piece_id text;
alter table public.order_items add column if not exists piece_code text;

-- 3. Update create_checkout to accept pieces and support both channels reliably
create or replace function public.create_checkout(
  p_customer uuid,
  p_key uuid,
  p_cart jsonb,
  p_address jsonb,
  p_channel text,
  p_coupon text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  s public.store_settings;
  o public.orders;
  pr public.products;
  off public.offers;
  cand public.offers;
  line record;
  fingerprint text;
  oid uuid := gen_random_uuid();
  subtotal bigint := 0;
  discount bigint := 0;
  shipping int;
  tax bigint;
  unit int;
  total bigint;
  selected_offer uuid;
  d bigint;
begin
  perform pg_advisory_xact_lock_shared(761117030);

  if not exists(select 1 from public.profiles where id = p_customer and not suspended) then
    raise exception 'ACCOUNT_DISABLED';
  end if;

  select * into s from public.store_settings where id;
  if not s.ordering_enabled then
    raise exception 'ORDERING_DISABLED';
  end if;

  if p_channel not in ('whatsapp', 'upi', 'razorpay') then
    raise exception 'INVALID_CHANNEL';
  end if;

  -- Verify channel availability against store settings
  if (p_channel = 'whatsapp' and s.checkout_mode = 'online_only') or
     (p_channel <> 'whatsapp' and s.checkout_mode = 'whatsapp_only') or
     (p_channel = 'upi' and s.online_method <> 'manual_upi' and s.online_method <> 'razorpay_upi' and coalesce(s.upi_id, '') = '') or
     (p_channel = 'razorpay' and s.online_method <> 'razorpay_upi') then
    raise exception 'CHANNEL_DISABLED';
  end if;

  if jsonb_typeof(p_cart) <> 'array' or jsonb_array_length(p_cart) not between 1 and 20 then
    raise exception 'INVALID_CART';
  end if;

  if jsonb_typeof(p_address) <> 'object' or
     length(coalesce(p_address->>'name', '')) < 2 or
     length(coalesce(p_address->>'phone', '')) < 7 or
     length(coalesce(p_address->>'line1', '')) < 4 or
     coalesce(p_address->>'pin', '') !~ '^[1-9][0-9]{5}$' then
    raise exception 'INVALID_ADDRESS';
  end if;

  fingerprint := encode(sha256(convert_to(p_cart::text || p_address::text || p_channel || coalesce(p_coupon, ''), 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtext(p_customer::text));

  select * into o from public.orders where customer_id = p_customer and checkout_key = p_key;
  if found then
    if o.request_hash <> fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return o.id;
  end if;

  if (select count(*) from public.orders where customer_id = p_customer and stock_state = 'reserved') >= 10 then
    raise exception 'TOO_MANY_PENDING_ORDERS';
  end if;

  if exists(select 1 from jsonb_array_elements(p_cart) x where jsonb_typeof(x->'quantity') <> 'number' or (x->>'quantity') !~ '^[0-9]+$' or (x->>'quantity')::numeric not between 1 and 20) then
    raise exception 'INVALID_QUANTITY';
  end if;

  if (select count(distinct x->>'product_id') from jsonb_array_elements(p_cart) x) <> jsonb_array_length(p_cart) then
    raise exception 'DUPLICATE_ITEM';
  end if;

  if p_coupon is not null and trim(p_coupon) <> '' then
    select * into off from public.offers where code = upper(trim(p_coupon)) for update;
    if not found then
      raise exception 'INVALID_COUPON';
    end if;
  end if;

  for line in select (x->>'product_id')::uuid pid, (x->>'quantity')::int qty from jsonb_array_elements(p_cart) x order by (x->>'product_id')::uuid loop
    select * into pr from public.products where id = line.pid for update;
    if not found or not pr.published or not private.product_visible(pr) then
      raise exception 'PRODUCT_UNAVAILABLE';
    end if;
    if pr.price_paise <= 0 then
      raise exception 'PRICE_NOT_SET';
    end if;
    if pr.stock_on_hand - pr.reserved < line.qty then
      raise exception 'OUT_OF_STOCK';
    end if;
    unit := private.product_price(pr);
    subtotal := subtotal + unit::bigint * line.qty;
  end loop;

  if p_coupon is not null and trim(p_coupon) <> '' then
    d := private.offer_discount(off, p_cart, subtotal, p_customer);
    if d <= 0 then
      raise exception 'COUPON_NOT_ELIGIBLE';
    end if;
    selected_offer := off.id;
    discount := d;
  else
    for cand in select * from public.offers where code is null and active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()) and (max_uses is null or used_count < max_uses) order by priority desc, id for update loop
      d := private.offer_discount(cand, p_cart, subtotal, p_customer);
      if d > discount then
        discount := d;
        selected_offer := cand.id;
      end if;
    end loop;
  end if;

  if selected_offer is not null then
    update public.offers set used_count = used_count + 1 where id = selected_offer;
  end if;

  shipping := case when s.free_shipping_above_paise > 0 and subtotal - discount >= s.free_shipping_above_paise then 0 else s.shipping_paise end;
  tax := round((subtotal - discount)::numeric * s.tax_bps / 10000)::bigint;
  total := subtotal - discount + shipping + tax;

  if total <= 0 or total > 2000000000 then
    raise exception 'INVALID_ORDER_TOTAL';
  end if;

  insert into public.orders(
    id, customer_id, checkout_key, request_hash, channel, address, customer_phone,
    subtotal_paise, discount_paise, shipping_paise, tax_paise, total_paise, offer_id,
    coupon_counted, expires_at
  ) values (
    oid, p_customer, p_key, fingerprint, p_channel, p_address, p_address->>'phone',
    subtotal, discount, shipping, tax, total, selected_offer,
    selected_offer is not null, now() + make_interval(mins => s.reservation_minutes)
  );

  for line in select (x->>'product_id')::uuid pid, (x->>'quantity')::int qty, (x->>'piece_id') piece_id, (x->>'piece_code') piece_code from jsonb_array_elements(p_cart) x order by (x->>'product_id')::uuid loop
    select * into pr from public.products where id = line.pid;
    unit := private.product_price(pr);
    insert into public.order_items(
      order_id, product_id, name, image_path, quantity, unit_price_paise, list_price_paise, line_total_paise,
      piece_id, piece_code
    ) values (
      oid, pr.id, pr.name, pr.image_path, line.qty, unit, pr.price_paise, unit::bigint * line.qty,
      line.piece_id, line.piece_code
    );
    update public.products set reserved = reserved + line.qty where id = pr.id;
  end loop;

  insert into public.order_events(order_id, actor_id, message)
  values (oid, p_customer, 'Order created. Waiting for payment.');

  perform private.notify(oid, 'Order received', 'Your order was saved. Complete your selected payment step.');
  return oid;
end $$;

grant execute on function public.create_checkout(uuid, uuid, jsonb, jsonb, text, text) to service_role;
