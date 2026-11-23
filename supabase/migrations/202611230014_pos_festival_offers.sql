-- 202611230014_pos_festival_offers.sql
-- Automatic festival offers (no coupon code) now apply at the POS counter as well
-- as online, using the same target rules (private.offer_discount from migration 013).
-- The counter (walk-in / spot) discount stays separately capped by POS settings.
-- pos_sales.discount_paise holds offer + counter discount; pricing_snapshot keeps the split.
-- Each offer opts in with offers.apply_in_pos (off by default = online only).

alter table public.offers add column if not exists apply_in_pos boolean not null default false;

create or replace function public.pos_quote(p_actor uuid,p_cart jsonb,p_discount bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.pos_settings;p public.products;x jsonb;items jsonb:='[]';subtotal bigint:=0;tax bigint;unit int;qty int;offer_title text;offer_paise bigint:=0;cand public.offers;d bigint;
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
 for cand in select * from public.offers where code is null and active and apply_in_pos and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>now()) and (max_uses is null or used_count<max_uses) order by priority desc, id loop
  d:=private.offer_discount(cand,p_cart,subtotal,null);
  if d>offer_paise then offer_paise:=d; offer_title:=cand.title; end if;
 end loop;
 if p_discount+offer_paise>=subtotal then raise exception 'INVALID_ORDER_TOTAL';end if;
 tax:=round((subtotal-offer_paise-p_discount)::numeric*s.tax_bps/10000)::bigint;
 return jsonb_build_object('items',items,'subtotal_paise',subtotal,'discount_paise',p_discount,'offer_discount_paise',offer_paise,'offer_title',offer_title,'tax_paise',tax,'total_paise',subtotal-offer_paise-p_discount+tax,'max_discount_paise',floor(subtotal::numeric*s.max_discount_bps/10000));
end $$;

create or replace function public.pos_checkout(p_actor uuid,p_key uuid,p_cart jsonb,p_customer jsonb,p_discount bigint,p_tenders jsonb,p_cash_received bigint,p_bank_checked boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.pos_settings; pr public.products; o public.pos_sales; line record; t jsonb; items jsonb:='[]'; subtotal bigint:=0; tax bigint; total bigint; tender_total bigint:=0; cash bigint:=0; unit int; fingerprint text; offer_id uuid; offer_title text; offer_paise bigint:=0; cand public.offers; d bigint; key uuid:=gen_random_uuid(); serial bigint; inv text;
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
 -- Automatic festival offer (same target rules as online checkout); best one wins.
 for cand in select * from public.offers where code is null and active and apply_in_pos and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>now()) and (max_uses is null or used_count<max_uses) order by priority desc, id for update loop
  d:=private.offer_discount(cand,p_cart,subtotal,null);
  if d>offer_paise then offer_paise:=d; offer_id:=cand.id; offer_title:=cand.title; end if;
 end loop;
 if p_discount>0 and length(trim(coalesce(p_customer->>'discount_reason','')))<3 then raise exception 'DISCOUNT_REASON_REQUIRED'; end if;
 if p_discount<0 or p_discount>floor(subtotal::numeric*s.max_discount_bps/10000) then raise exception 'DISCOUNT_LIMIT'; end if;
 if p_discount+offer_paise>=subtotal then raise exception 'INVALID_ORDER_TOTAL'; end if;
 tax:=round((subtotal-offer_paise-p_discount)::numeric*s.tax_bps/10000)::bigint; total:=subtotal-offer_paise-p_discount+tax;
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
 overriding system value values(key,serial,p_actor,p_key,fingerprint,inv,coalesce(p_customer->>'name',''),coalesce(p_customer->>'phone',''),to_jsonb(s)-'enabled'-'max_discount_bps',items,p_tenders,subtotal,offer_paise+p_discount,tax,total,p_cash_received,p_cash_received-cash);
 if offer_id is not null then update public.offers set used_count=used_count+1 where id=offer_id; end if;
 perform set_config('store.sale_id',key::text,true); perform set_config('store.order_id','',true); perform set_config('store.purchase_id','',true);
 for line in select * from jsonb_to_recordset(items) as x(product_id uuid,quantity int,unit_ids jsonb) order by product_id loop
  perform set_config('store.unit_ids',line.unit_ids::text,true);
  update public.products set stock_on_hand=stock_on_hand-line.quantity,updated_at=now() where id=line.product_id;
  insert into public.inventory_movements(product_id,actor_id,delta,reason) values(line.product_id,p_actor,-line.quantity,'POS sale '||inv);
 end loop;
 update public.pos_sales set discount_reason=coalesce(p_customer->>'discount_reason',''),pricing_snapshot=jsonb_build_object('catalogue_prices',pos_sales.items,'walkin_discount_paise',p_discount,'offer_id',offer_id,'offer_title',offer_title,'offer_discount_paise',offer_paise,'max_discount_bps',s.max_discount_bps) where id=key;
 perform private.audit(p_actor,'pos.completed','pos_sales',key::text,jsonb_build_object('invoice',inv,'total_paise',total)); return key;
end $$;
revoke all on function public.pos_quote(uuid,jsonb,bigint),public.pos_checkout(uuid,uuid,jsonb,jsonb,bigint,jsonb,bigint,boolean) from public,anon,authenticated;
grant execute on function public.pos_quote(uuid,jsonb,bigint),public.pos_checkout(uuid,uuid,jsonb,jsonb,bigint,jsonb,bigint,boolean) to service_role;
