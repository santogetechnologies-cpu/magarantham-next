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
