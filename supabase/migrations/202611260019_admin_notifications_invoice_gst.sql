-- 202611260019_admin_notifications_invoice_gst.sql
-- 1. Configurable GST & Invoice fields on store_settings
alter table public.store_settings add column if not exists gstin text not null default '';
alter table public.store_settings add column if not exists store_address text not null default 'Tiruppur & Kanchipuram, Tamil Nadu, India';
alter table public.store_settings add column if not exists invoice_prefix text not null default 'MS-INV-';

-- 2. Invoice & WhatsApp status snapshot columns on orders
alter table public.orders add column if not exists invoice_number text not null default '';
alter table public.orders add column if not exists invoice_pdf_url text not null default '';
alter table public.orders add column if not exists whatsapp_status text not null default 'pending' check (whatsapp_status in ('pending','sent','delivered','failed'));
alter table public.orders add column if not exists whatsapp_sent_at timestamptz;
alter table public.orders add column if not exists whatsapp_error text not null default '';

-- 3. Real-time Admin Order Notifications table
create table if not exists public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  order_number bigint not null,
  customer_name text not null default 'Customer',
  customer_phone text not null default '',
  item_count int not null default 1,
  total_paise bigint not null default 0,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists admin_notifications_unread_idx on public.admin_notifications(is_read, created_at desc);

alter table public.admin_notifications enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'admin_notifications' and policyname = 'admin_notifications_staff'
  ) then
    create policy admin_notifications_staff on public.admin_notifications
      for all using (private.can_actor(auth.uid(), 'orders'));
  end if;
end $$;

grant all on public.admin_notifications to service_role;

-- Enable Supabase Realtime if publication exists
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.admin_notifications;
  end if;
exception when others then null;
end $$;
