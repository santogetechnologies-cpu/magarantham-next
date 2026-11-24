-- 202611240015_pos_customisation.sql
-- Counter-wide POS preferences, editable in POS Settings and shared by every till:
-- quick discount buttons, round-off amounts, default payment mode, auto-print and
-- whether the customer's mobile number is required.

alter table public.pos_settings add column if not exists spot_discount_options int[] not null default '{5,10,15,20,25}';
alter table public.pos_settings add column if not exists bill_discount_options int[] not null default '{5,10,15}';
alter table public.pos_settings add column if not exists round_off_options int[] not null default '{10,100}';
alter table public.pos_settings add column if not exists default_pay_mode text not null default 'cash';
alter table public.pos_settings add column if not exists auto_print boolean not null default true;
alter table public.pos_settings add column if not exists require_customer_phone boolean not null default false;
alter table public.pos_settings drop constraint if exists pos_settings_pay_mode_check;
alter table public.pos_settings add constraint pos_settings_pay_mode_check check (default_pay_mode in ('cash','upi','card'));
alter table public.pos_settings drop constraint if exists pos_settings_options_check;
alter table public.pos_settings add constraint pos_settings_options_check check (
  cardinality(spot_discount_options)<=8 and cardinality(bill_discount_options)<=8 and cardinality(round_off_options)<=4
  and 1<=all(spot_discount_options) and 90>=all(spot_discount_options)
  and 1<=all(bill_discount_options) and 90>=all(bill_discount_options)
  and 1<=all(round_off_options) and 1000>=all(round_off_options));

create or replace function public.erp_save(p_actor uuid,p_entity text,p_id uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
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
  update public.pos_settings set enabled=(p_data->>'enabled')::boolean,business_name=p_data->>'business_name',business_english=p_data->>'business_english',address=p_data->>'address',phone=p_data->>'phone',gstin=p_data->>'gstin',invoice_prefix=p_data->>'invoice_prefix',receipt_footer=p_data->>'receipt_footer',tax_bps=(p_data->>'tax_bps')::int,max_discount_bps=(p_data->>'max_discount_bps')::int,paper_mm=(p_data->>'paper_mm')::int,
   spot_discount_options=case when p_data ? 'spot_discount_options' then array(select v::int from jsonb_array_elements_text(p_data->'spot_discount_options') v) else spot_discount_options end,
   bill_discount_options=case when p_data ? 'bill_discount_options' then array(select v::int from jsonb_array_elements_text(p_data->'bill_discount_options') v) else bill_discount_options end,
   round_off_options=case when p_data ? 'round_off_options' then array(select v::int from jsonb_array_elements_text(p_data->'round_off_options') v) else round_off_options end,
   default_pay_mode=coalesce(p_data->>'default_pay_mode',default_pay_mode),
   auto_print=coalesce((p_data->>'auto_print')::boolean,auto_print),
   require_customer_phone=coalesce((p_data->>'require_customer_phone')::boolean,require_customer_phone),
   updated_at=now() where id;
 elsif p_entity='salary_policies' then
  perform pg_advisory_xact_lock(761117020);
  perform private.validate_salary_policy(p_data);
  insert into public.salary_policies(id,name,divisor_mode,work_weekdays,paid_leave_units,leave_rule_mode,leave_tiers,default_leave_lop_bps,half_day_pay_bps,paid_permission_minutes,permission_lop,holiday_paid,active)
  select key,x.name,x.divisor_mode,x.work_weekdays,x.paid_leave_units,x.leave_rule_mode,x.leave_tiers,x.default_leave_lop_bps,x.half_day_pay_bps,x.paid_permission_minutes,x.permission_lop,x.holiday_paid,x.active from jsonb_populate_record(null::public.salary_policies,p_data)x
  on conflict(id)do update set name=excluded.name,divisor_mode=excluded.divisor_mode,work_weekdays=excluded.work_weekdays,paid_leave_units=excluded.paid_leave_units,leave_rule_mode=excluded.leave_rule_mode,leave_tiers=excluded.leave_tiers,default_leave_lop_bps=excluded.default_leave_lop_bps,half_day_pay_bps=excluded.half_day_pay_bps,paid_permission_minutes=excluded.paid_permission_minutes,permission_lop=excluded.permission_lop,holiday_paid=excluded.holiday_paid,active=excluded.active,updated_at=now();
 end if;
 perform private.audit(p_actor,'erp.saved',p_entity,key::text); return key;
end $$;
revoke all on function public.erp_save(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.erp_save(uuid,text,uuid,jsonb) to service_role;
