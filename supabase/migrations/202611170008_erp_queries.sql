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
