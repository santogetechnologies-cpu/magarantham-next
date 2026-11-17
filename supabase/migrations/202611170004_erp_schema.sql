-- ERP upgrade. Apply after 001,002,003. Enum changes commit before 005.
alter type public.app_role add value if not exists 'billing';
alter table public.profiles alter column permissions set default array['catalogue','inventory','orders','payments','content','offers','shipping','bulk','pos','purchases','expenses','attendance','reports'];
create table public.product_categories (
 id uuid primary key default gen_random_uuid(), parent_id uuid references public.product_categories(id),
 name text not null check(length(name) between 1 and 80), slug text not null unique check(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 active boolean not null default true, created_at timestamptz not null default now(), check(parent_id is null or parent_id<>id)
);
alter table public.products add column subcategory_id uuid references public.product_categories(id);
insert into public.product_categories(name,slug) select distinct category,'legacy-'||substr(md5(category),1,12) from public.products;
insert into public.product_categories(parent_id,name,slug) select id,'All styles',slug||'-all' from public.product_categories where parent_id is null;
update public.products p set subcategory_id=c.id from public.product_categories c join public.product_categories m on m.id=c.parent_id where m.name=p.category;
create table public.catalog_discounts (
 id uuid primary key default gen_random_uuid(), name text not null, scope text not null check(scope in ('category','subcategory','product')),
 target_id uuid not null, discount_bps int not null check(discount_bps between 1 and 9000), active boolean not null default false,
 starts_at timestamptz, ends_at timestamptz, created_at timestamptz not null default now(), check(ends_at is null or starts_at is null or ends_at>starts_at)
);
create table public.suppliers (
 id uuid primary key default gen_random_uuid(), name text not null, phone text not null default '', email text not null default '',
 address text not null default '', gstin text not null default '', active boolean not null default true, created_at timestamptz not null default now()
);
create table public.purchases (
 id uuid primary key default gen_random_uuid(), number bigint generated always as identity unique,
 supplier_id uuid not null references public.suppliers(id), supplier_invoice text not null default '', note text not null default '',
 status text not null default 'draft' check(status in ('draft','ordered','partial','received','cancelled')),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), expected_on date,
 unique(supplier_id,supplier_invoice)
);
-- Blank supplier invoice is allowed repeatedly; nonblank invoices must be unique per supplier.
alter table public.purchases drop constraint purchases_supplier_id_supplier_invoice_key;
create unique index purchase_supplier_invoice on public.purchases(supplier_id,lower(supplier_invoice)) where supplier_invoice<>'';
create table public.purchase_items (
 id uuid primary key default gen_random_uuid(), purchase_id uuid not null references public.purchases(id), product_id uuid not null references public.products(id),
 quantity int not null check(quantity between 1 and 10000), received int not null default 0 check(received>=0 and received<=quantity),
 returned int not null default 0 check(returned>=0 and returned<=received), unit_cost_paise int not null check(unit_cost_paise between 0 and 100000000),
 tax_bps int not null default 0 check(tax_bps between 0 and 10000), unique(purchase_id,product_id)
);
create table public.purchase_receipts (
 id uuid primary key default gen_random_uuid(), purchase_id uuid not null references public.purchases(id), request_key uuid not null unique,
 fingerprint text not null, kind text not null check(kind in ('receive','return')), lines jsonb not null, actor_id uuid not null, note text not null default '', created_at timestamptz not null default now()
);
create table public.purchase_payments (
 id uuid primary key default gen_random_uuid(), purchase_id uuid not null references public.purchases(id), request_key uuid not null unique, fingerprint text not null,
 direction text not null check(direction in ('paid','refund')), amount_paise bigint not null check(amount_paise>0), method text not null check(method in ('cash','upi','card','bank')),
 reference text not null, actor_id uuid not null, created_at timestamptz not null default now()
);
create sequence private.unit_barcode_seq;
create table public.product_units (
 id bigint generated always as identity primary key, product_id uuid not null references public.products(id), barcode text not null unique,
 state text not null default 'in_stock' check(state in ('in_stock','sold','removed')), purchase_id uuid references public.purchases(id),
 sale_id uuid references public.pos_sales(id), order_id uuid references public.orders(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), printed_at timestamptz
);
create index product_units_available on public.product_units(product_id,id) where state='in_stock';
create table public.expense_categories (
 id uuid primary key default gen_random_uuid(), name text not null unique, active boolean not null default true, created_at timestamptz not null default now()
);
insert into public.expense_categories(name) values('Rent'),('Electricity'),('Transport'),('Shop supplies'),('Payroll'),('Other');
create table public.expenses (
 id uuid primary key default gen_random_uuid(), request_key uuid not null unique, fingerprint text not null,
 category_id uuid not null references public.expense_categories(id), expense_on date not null, description text not null,
 amount_paise bigint not null check(amount_paise>0 and amount_paise<=2000000000), method text not null check(method in ('cash','upi','card','bank')),
 reference text not null default '', payee text not null default '', status text not null default 'posted' check(status in ('posted','void')),
 source text not null default 'manual' check(source in ('manual','payroll')), payroll_id uuid unique references public.payroll_runs(id),
 actor_id uuid not null, void_by uuid, void_reason text, created_at timestamptz not null default now()
);
create table public.salary_policies (
 id uuid primary key default gen_random_uuid(), name text not null, divisor_mode text not null default 'scheduled' check(divisor_mode in ('calendar','scheduled')),
 work_weekdays int[] not null default array[1,2,3,4,5,6], paid_leave_units numeric(4,1) not null default 0 check(paid_leave_units between 0 and 31),
 leave_rule_mode text not null default 'ordinal' check(leave_rule_mode in ('ordinal','monthly_total')),
 leave_tiers jsonb not null default '[]', default_leave_lop_bps int not null default 10000 check(default_leave_lop_bps between 0 and 10000),
 half_day_pay_bps int not null default 5000 check(half_day_pay_bps between 0 and 10000),
 paid_permission_minutes int not null default 0 check(paid_permission_minutes between 0 and 14400),
 permission_lop text not null default 'proportional' check(permission_lop in ('proportional','half_day','full_day')),
 holiday_paid boolean not null default true, active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
insert into public.salary_policies(name) values('Shop default: six-day week, unpaid leave');
alter table public.employees add column profile_id uuid unique references public.profiles(id);
alter table public.employees add column phone text not null default '';
alter table public.employees add column joined_on date not null default current_date;
alter table public.employees add column ended_on date;
alter table public.employees add column daily_minutes int not null default 480 check(daily_minutes between 60 and 1440);
alter table public.employees add column policy_id uuid references public.salary_policies(id);
update public.employees set policy_id=(select id from public.salary_policies limit 1);
create table public.attendance (
 id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employees(id), work_on date not null,
 status text not null check(status in ('full_day','half_day','leave','permission','weekly_off','holiday','absent')),
 leave_units numeric(2,1) not null default 1 check(leave_units in (0.5,1)),
 permission_minutes int not null default 0 check(permission_minutes between 0 and 1440),
 worked_minutes int not null default 480 check(worked_minutes between 0 and 1440), overtime_minutes int not null default 0 check(overtime_minutes between 0 and 1440),
 note text not null default '', marked_by uuid not null, updated_at timestamptz not null default now(), unique(employee_id,work_on)
);
alter table public.payroll_runs add column calculation jsonb;
alter table public.payroll_runs add column calculation_hash text;
alter table public.payroll_runs add column bonus_paise bigint not null default 0;
alter table public.payroll_runs add column payment_method text;
alter table public.pos_sales add column pricing_snapshot jsonb not null default '{}';
alter table public.pos_sales add column discount_reason text not null default '';

create or replace function private.can_actor(actor uuid,cap text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=actor and not p.suspended and
 (p.role::text='superadmin' or (
 not exists(select 1 from public.employees e where e.profile_id=p.id and not e.active) and
 ((p.role::text='manager' and cap=any(p.permissions)) or (p.role::text='billing' and cap='pos' and exists(select 1 from public.employees e where e.profile_id=p.id and e.active))))));
$$;
create or replace function private.sync_auth_profile() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.app_role;
begin
 if tg_op='UPDATE' and new.email is distinct from old.email then update public.profiles set email=coalesce(new.email,'') where id=new.id; end if;
 if tg_op='UPDATE' and (new.raw_app_meta_data->'store_role') is not distinct from (old.raw_app_meta_data->'store_role') then return new; end if;
 if new.raw_app_meta_data ? 'store_role' then
  if new.raw_app_meta_data->>'store_role' not in ('customer','manager','billing','superadmin') or new.raw_app_meta_data->>'store_role' is null then raise exception 'INVALID_PROTECTED_ROLE'; end if;
  r:=(new.raw_app_meta_data->>'store_role')::public.app_role;
 elsif tg_op='INSERT' then r:='superadmin'; else raise exception 'PROTECTED_ROLE_CANNOT_BE_REMOVED'; end if;
 insert into public.profiles(id,email,display_name,role) values(new.id,coalesce(new.email,''),left(coalesce(new.raw_user_meta_data->>'name',''),80),r)
 on conflict(id) do update set role=excluded.role,email=excluded.email;
 return new;
end $$;
create function private.product_visible(p public.products) returns boolean language sql stable security definer set search_path='' as $$
 select not p.archived and (p.subcategory_id is null or exists(select 1 from public.product_categories s join public.product_categories m on m.id=s.parent_id where s.id=p.subcategory_id and s.active and m.active));
$$;
create function private.product_price(p public.products) returns int language sql stable security definer set search_path='' as $$
 select floor(p.price_paise::numeric*(10000-greatest(p.discount_percent*100,coalesce((
 select max(d.discount_bps) from public.catalog_discounts d left join public.product_categories s on s.id=p.subcategory_id
 where d.active and (d.starts_at is null or d.starts_at<=now()) and (d.ends_at is null or d.ends_at>now()) and
 ((d.scope='product' and d.target_id=p.id) or (d.scope='subcategory' and d.target_id=p.subcategory_id) or (d.scope='category' and d.target_id=s.parent_id))
 ),0)))/10000)::int;
$$;
create view public.store_catalogue with (security_invoker=true) as
 select p.*, private.product_price(p) as effective_price_paise,s.name as subcategory_name,m.id as category_id,m.name as category_name,
 private.product_visible(p) as category_visible from public.products p left join public.product_categories s on s.id=p.subcategory_id left join public.product_categories m on m.id=s.parent_id;
revoke all on public.store_catalogue from public,anon,authenticated;
grant select on public.store_catalogue to service_role;

-- MSU prefix is reserved exclusively for generated serialized unit stickers.
alter table public.products add constraint product_barcode_namespace check(barcode is null or barcode !~ '^MSU[0-9]+$');
create function private.stock_unit_sync() returns trigger language plpgsql security definer set search_path='' as $$
declare delta int; restored int:=0; selected bigint[]; wanted bigint[]; sale uuid; ord uuid; purchase uuid;
begin
 delta:=new.stock_on_hand-case when tg_op='INSERT' then 0 else old.stock_on_hand end;
 if delta=0 then return new; end if;
 if abs(delta)>10000 then raise exception 'STOCK_BATCH_LIMIT_10000'; end if;
 sale:=nullif(current_setting('store.sale_id',true),'')::uuid; ord:=nullif(current_setting('store.order_id',true),'')::uuid; purchase:=nullif(current_setting('store.purchase_id',true),'')::uuid;
 if delta>0 then
  if sale is not null or ord is not null then
   select array_agg(id) into selected from (select id from public.product_units where product_id=new.id and state='sold' and ((sale is not null and sale_id=sale) or (ord is not null and order_id=ord)) order by id limit delta for update)q;
   update public.product_units set state='in_stock',sale_id=null,order_id=null,updated_at=now() where id=any(coalesce(selected,'{}'));
   get diagnostics restored=row_count;
  end if;
  insert into public.product_units(product_id,barcode,purchase_id) select new.id,'MSU'||lpad(nextval('private.unit_barcode_seq')::text,12,'0'),purchase from generate_series(1,delta-restored);
 else
  select coalesce(array_agg(value::bigint),'{}') into wanted from jsonb_array_elements_text(coalesce(nullif(current_setting('store.unit_ids',true),''),'[]')::jsonb);
  if cardinality(wanted)>0 and cardinality(wanted)<>-delta then raise exception 'BARCODE_QUANTITY_MISMATCH'; end if;
  select array_agg(id) into selected from (select id from public.product_units where product_id=new.id and state='in_stock' and (cardinality(wanted)=0 or id=any(wanted)) order by id limit -delta for update)q;
  if cardinality(coalesce(selected,'{}'))<>-delta then raise exception 'UNIT_STOCK_MISMATCH'; end if;
  update public.product_units set state=case when sale is not null or ord is not null then 'sold' else 'removed' end,sale_id=sale,order_id=ord,updated_at=now() where id=any(selected);
 end if;
 return new;
end $$;
insert into public.product_units(product_id,barcode) select p.id,'MSU'||lpad(nextval('private.unit_barcode_seq')::text,12,'0') from public.products p cross join lateral generate_series(1,p.stock_on_hand);
create trigger sync_product_units after insert or update of stock_on_hand on public.products for each row execute function private.stock_unit_sync();

do $$ declare t text; begin foreach t in array array['product_categories','catalog_discounts','suppliers','purchases','purchase_items','purchase_receipts','purchase_payments','product_units','expense_categories','expenses','salary_policies','attendance'] loop
 execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from public,anon,authenticated',t); execute format('grant all on public.%I to service_role',t);
end loop; end $$;
grant usage,select on all sequences in schema public to service_role;
revoke all on all functions in schema private from public,anon,authenticated;

grant usage on schema private to service_role;
grant execute on function private.product_price(public.products),private.product_visible(public.products) to service_role;
