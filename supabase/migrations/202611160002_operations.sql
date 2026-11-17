-- Durable provider hand-offs and auditable privileged configuration.
alter table public.orders add column gateway_state text not null default 'new' check(gateway_state in ('new','creating','ready','review'));
create function public.admin_save(p_actor uuid,p_entity text,p_id uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare cap text; key uuid:=coalesce(p_id,gen_random_uuid()); oldrow jsonb; stmt text; col text; vals text:=''; cols text:=''; allowed text[];
begin
 cap:=case p_entity when 'products' then 'catalogue' when 'banners' then 'content' when 'offers' then 'offers' when 'tracking_providers' then 'shipping' when 'bulk_inquiries' then 'bulk' when 'store_settings' then '__super' else null end;
 if cap is null or not private.can_actor(p_actor,cap) then raise exception 'FORBIDDEN'; end if;
 allowed:=case p_entity
 when 'products' then array['sku','slug','name','category','colour','description','image_path','price_paise','discount_percent','published','archived','featured']
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
create function public.set_tracking(p_actor uuid,p_order uuid,p_provider uuid,p_tracking text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.can_actor(p_actor,'shipping') then raise exception 'FORBIDDEN'; end if;
 if not exists(select 1 from public.tracking_providers where id=p_provider and enabled) or length(trim(p_tracking)) not between 2 and 100 then raise exception 'INVALID_TRACKING'; end if;
 perform 1 from public.orders where id=p_order and status in ('confirmed','packing','shipped') for update;
 if not found then raise exception 'INVALID_STATUS_CHANGE'; end if;
 update public.orders set tracking_provider_id=p_provider,tracking_id=trim(p_tracking),updated_at=now() where id=p_order;
 insert into public.order_events(order_id,actor_id,message) values(p_order,p_actor,'Tracking information added: '||trim(p_tracking));
 perform private.audit(p_actor,'tracking.updated','orders',p_order::text);
 perform private.notify(p_order,'Tracking update','You can now view tracking in your order.');
end $$;
create function public.submit_payment_proof(p_customer uuid,p_order uuid,p_path text,p_reference text) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
 select * into o from public.orders where id=p_order and customer_id=p_customer for update;
 if not found or o.channel='razorpay' or o.status not in ('awaiting_payment','expired','cancelled') or o.payment_status not in ('pending','submitted','failed') then raise exception 'PROOF_NOT_ALLOWED'; end if;
 insert into public.payment_proofs(order_id,customer_id,storage_path,reference) values(p_order,p_customer,p_path,p_reference);
 update public.orders set payment_status='submitted' where id=p_order;
 insert into public.order_events(order_id,actor_id,message) values(p_order,p_customer,'Payment proof submitted. Waiting for a bank check.');
end $$;
create function public.gateway_claim(p_customer uuid,p_order uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.orders set gateway_state='creating' where id=p_order and customer_id=p_customer and channel='razorpay' and status='awaiting_payment' and expires_at>now() and gateway_state='new';
 return found;
end $$;
create function public.refund_begin(p_actor uuid,p_order uuid,p_note text) returns uuid language plpgsql security definer set search_path='' as $$
declare o public.orders; key uuid;
begin
 if not private.can_actor(p_actor,'payments') then raise exception 'FORBIDDEN'; end if;
 select * into o from public.orders where id=p_order for update;
 if o.payment_status not in ('refund_pending','late_paid') or length(trim(p_note))<3 then raise exception 'REFUND_NOT_ALLOWED'; end if;
 if o.channel<>'razorpay' then
   select id into key from public.refunds where order_id=p_order;
   if found then
     perform private.audit(p_actor,'refund.manual_recovery','orders',p_order::text);
     return key;
   end if;
 end if;
 insert into public.refunds(order_id,status,note) values(p_order,'processing',p_note) returning id into key;
 perform private.audit(p_actor,'refund.started','orders',p_order::text);
 return key;
end $$;
create function public.refund_complete(p_order uuid,p_provider text,p_reference text,p_event text) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
 select * into o from public.orders where id=p_order for update;
 if not found or o.payment_status not in ('refund_pending','late_paid','refunded') then raise exception 'REFUND_NOT_ALLOWED'; end if;
 if o.payment_status='refunded' then return; end if;
 insert into private.payment_events(event_id) values(p_event) on conflict do nothing;
 if not found then return; end if;
 update public.refunds set status='processed',provider_refund_id=p_provider,reference=p_reference where order_id=p_order;
 if not found then raise exception 'REFUND_NOT_STARTED'; end if;
 update public.orders set payment_status='refunded',updated_at=now() where id=p_order;
 insert into public.order_events(order_id,message) values(p_order,'Full refund completed.');
 perform private.notify(p_order,'Refund completed','Your full refund has been recorded. Bank processing may take additional time.');
end $$;
create function public.staff_update(p_actor uuid,p_user uuid,p_permissions text[],p_suspended boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(761116001);
 if not exists(select 1 from public.profiles where id=p_actor and role='superadmin' and not suspended) or p_actor=p_user then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.profiles where id=p_user for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if exists(select 1 from public.profiles where id=p_user and role='superadmin') and p_suspended and (select count(*) from public.profiles where role='superadmin' and not suspended)<=1 then raise exception 'LAST_SUPERADMIN'; end if;
 update public.profiles set permissions=p_permissions,suspended=p_suspended where id=p_user;
 perform private.audit(p_actor,'staff.updated','profiles',p_user::text,jsonb_build_object('permissions',p_permissions,'suspended',p_suspended));
end $$;
create function public.email_claim() returns table(id uuid,email text,title text,body text,attempts int) language sql security definer set search_path='' as $$
 with picked as (select e.id from private.email_outbox e where e.state='pending' and e.available_at<=now() and e.attempts<5 order by available_at for update skip locked limit 25), claimed as (update private.email_outbox e set state='sending',attempts=e.attempts+1,available_at=now()+interval '5 minutes' from picked where e.id=picked.id returning e.*)
 select c.id,p.email,c.title,c.body,c.attempts from claimed c join public.profiles p on p.id=c.customer_id;
$$;
create function public.email_finish(p_id uuid,p_success boolean) returns void language sql security definer set search_path='' as $$
 update private.email_outbox set state=case when p_success then 'sent' else 'pending' end,available_at=now()+interval '10 minutes' where id=p_id;
$$;
create function public.email_recover() returns void language sql security definer set search_path='' as $$
 update private.email_outbox set state='pending' where state='sending' and available_at<now();
$$;
create function public.tracking_event(p_event text,p_order uuid,p_tracking text,p_status text) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
 select * into o from public.orders where id=p_order for update;
 if not found or o.tracking_id<>p_tracking or o.payment_status<>'paid' then raise exception 'TRACKING_MISMATCH'; end if;
 insert into private.payment_events(event_id) values('tracking:'||p_event) on conflict do nothing;
 if not found or o.status=p_status then return; end if;
 if not ((o.status='packing' and p_status='shipped') or (o.status='shipped' and p_status='delivered')) then raise exception 'INVALID_STATUS_CHANGE'; end if;
 update public.orders set status=p_status,updated_at=now() where id=p_order;
 insert into public.order_events(order_id,message) values(p_order,'Carrier update: '||p_status);
 perform private.notify(p_order,'Shipping update','Your order is now '||p_status||'.');
end $$;
-- No browser access to operational RPCs, including SECURITY DEFINER functions.
revoke all on all functions in schema public from public,anon,authenticated;
grant execute on function public.staff_access(text) to authenticated;
grant execute on function public.reject_public_signup(jsonb) to supabase_auth_admin;
grant execute on all functions in schema public to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('store-media','store-media',true,5242880,array['image/jpeg','image/png','image/webp']),
 ('payment-proofs','payment-proofs',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
-- Intentionally no storage write/read policies for client JWTs. Service endpoints authorize every upload/signed URL.
