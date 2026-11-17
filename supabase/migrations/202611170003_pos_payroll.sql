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
