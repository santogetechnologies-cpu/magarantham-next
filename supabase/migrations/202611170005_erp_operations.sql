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
