-- 202611260020_account_profile_avatar_default_addr.sql
-- 1. Profile avatar URL on profiles
alter table public.profiles add column if not exists avatar_url text not null default '';

-- 2. Default address flag on addresses
alter table public.addresses add column if not exists is_default boolean not null default false;
