-- 202611240016_expense_approval_units.sql
-- 1. Expenses entered by staff wait for an administrator's approval before they
--    count in reports. Administrator and payroll expenses post immediately.
-- 2. Products get a sale unit (piece, set, pair, metre, ...) so items other than
--    sarees show the right unit in POS and the online shop. Quantities stay whole numbers.

-- ---------------------------------------------------------------------------
-- 1. Expense approval
-- ---------------------------------------------------------------------------
alter table public.expenses drop constraint if exists expenses_status_check;
alter table public.expenses add constraint expenses_status_check check (status in ('pending','posted','rejected','void'));
alter table public.expenses add column if not exists reviewed_by uuid;
alter table public.expenses add column if not exists reviewed_at timestamptz;
alter table public.expenses add column if not exists review_note text not null default '';

create or replace function public.expense_post(p_actor uuid,p_key uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare key uuid:=gen_random_uuid(); old public.expenses; fingerprint text; super boolean;
begin
 if not private.can_actor(p_actor,'expenses') then raise exception 'FORBIDDEN'; end if;
 super:=private.can_actor(p_actor,'__super');
 fingerprint:=encode(sha256(convert_to(p_data::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtext('expense:'||p_key::text)); select * into old from public.expenses where request_key=p_key;
 if found then if old.fingerprint<>fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return old.id; end if;
 if not exists(select 1 from public.expense_categories where id=(p_data->>'category_id')::uuid and active) then raise exception 'CATEGORY_UNAVAILABLE'; end if;
 if p_data->>'method'<>'cash' and length(trim(p_data->>'reference'))<6 then raise exception 'PAYMENT_REFERENCE_REQUIRED'; end if;
 insert into public.expenses(id,request_key,fingerprint,category_id,expense_on,description,amount_paise,method,reference,payee,actor_id,status,reviewed_by,reviewed_at)
 values(key,p_key,fingerprint,(p_data->>'category_id')::uuid,(p_data->>'expense_on')::date,p_data->>'description',(p_data->>'amount_paise')::bigint,p_data->>'method',coalesce(p_data->>'reference',''),coalesce(p_data->>'payee',''),p_actor,
   case when super then 'posted' else 'pending' end, case when super then p_actor end, case when super then now() end);
 perform private.audit(p_actor,case when super then 'expense.posted' else 'expense.submitted' end,'expenses',key::text); return key;
end $$;

create or replace function public.expense_review(p_actor uuid,p_id uuid,p_action text,p_note text) returns void language plpgsql security definer set search_path='' as $$
declare e public.expenses;
begin
 if not private.can_actor(p_actor,'__super') then raise exception 'FORBIDDEN'; end if;
 select * into e from public.expenses where id=p_id for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if e.status<>'pending' then raise exception 'EXPENSE_NOT_PENDING'; end if;
 if p_action='approve' then
  update public.expenses set status='posted',reviewed_by=p_actor,reviewed_at=now(),review_note=coalesce(trim(p_note),'') where id=p_id;
 elsif p_action='reject' then
  if length(trim(coalesce(p_note,'')))<3 then raise exception 'REVIEW_NOTE_REQUIRED'; end if;
  update public.expenses set status='rejected',reviewed_by=p_actor,reviewed_at=now(),review_note=trim(p_note) where id=p_id;
 else raise exception 'INVALID_STATUS_CHANGE'; end if;
 perform private.audit(p_actor,'expense.'||p_action,'expenses',p_id::text,jsonb_build_object('note',p_note));
end $$;
revoke all on function public.expense_post(uuid,uuid,jsonb),public.expense_review(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.expense_post(uuid,uuid,jsonb),public.expense_review(uuid,uuid,text,text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Product sale unit
-- ---------------------------------------------------------------------------
alter table public.products add column if not exists sale_unit text not null default 'piece';
alter table public.products drop constraint if exists products_sale_unit_check;
alter table public.products add constraint products_sale_unit_check check (sale_unit in ('piece','set','pair','metre','pack','dozen','box'));

-- store_catalogue uses p.*, which PostgreSQL freezes when the view is created. It was
-- created before saree_type, fabric, design, purchase_price_paise, min_stock_level,
-- compare_at_price_paise (and now sale_unit) were added, so the website and POS never
-- received those fields. Drop and recreate it so every product column is exposed.
drop view if exists public.store_catalogue;
create view public.store_catalogue with (security_invoker=true) as
 select p.*, private.product_price(p) as effective_price_paise,s.name as subcategory_name,m.id as category_id,m.name as category_name,
 private.product_visible(p) as category_visible from public.products p left join public.product_categories s on s.id=p.subcategory_id left join public.product_categories m on m.id=s.parent_id;
revoke all on public.store_catalogue from public,anon,authenticated;
grant select on public.store_catalogue to service_role;

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
 when 'products' then array['barcode','subcategory_id','sku','slug','name','category','colour','description','image_path','price_paise','discount_percent','published','archived','featured','saree_type','fabric','design','purchase_price_paise','min_stock_level','compare_at_price_paise','sale_unit']
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
