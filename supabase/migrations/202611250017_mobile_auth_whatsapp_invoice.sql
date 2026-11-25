-- 202611250017_mobile_auth_whatsapp_invoice.sql
-- 1. Mobile Phone Authentication: support phone-based customer login & account linking.
-- 2. Customer Phone on Orders: store verified customer phone directly on orders for quick reference.
-- 3. WhatsApp Notification Delivery & Status Tracking: idempotent delivery log for order confirmations with PDF invoices.
-- 4. Invoices Bucket: private storage for generated customer invoices.

-- 1. Profiles: add phone number and confirmation timestamp
alter table public.profiles add column if not exists phone text not null default '';
alter table public.profiles add column if not exists phone_confirmed_at timestamptz;
create index if not exists profiles_phone_idx on public.profiles(phone) where phone <> '';

-- 2. Orders: add customer phone column
alter table public.orders add column if not exists customer_phone text not null default '';
create index if not exists orders_customer_phone_idx on public.orders(customer_phone) where customer_phone <> '';

-- 3. WhatsApp Notifications: track delivery status, message IDs, and avoid duplicate sends
create table if not exists public.whatsapp_notifications (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_id uuid references public.profiles(id) on delete set null,
  recipient_phone text not null,
  template_name text not null default 'order_confirmation',
  status text not null default 'pending' check (status in ('pending','sent','delivered','failed')),
  whatsapp_message_id text,
  pdf_storage_path text,
  error_message text,
  attempts int not null default 0,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists unique_whatsapp_order_confirmation on public.whatsapp_notifications(order_id);
create index if not exists whatsapp_notifications_status_idx on public.whatsapp_notifications(status);
create index if not exists whatsapp_notifications_customer_idx on public.whatsapp_notifications(customer_id);

-- Enable RLS on whatsapp_notifications
alter table public.whatsapp_notifications enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'whatsapp_notifications' and policyname = 'whatsapp_notifications_owner'
  ) then
    create policy whatsapp_notifications_owner on public.whatsapp_notifications
      for select using (
        customer_id = auth.uid() or
        private.can_actor(auth.uid(), 'orders')
      );
  end if;
end $$;

grant all on public.whatsapp_notifications to service_role;

-- 4. Invoices Storage Bucket (private, max 10MB per PDF)
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('invoices', 'invoices', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;
