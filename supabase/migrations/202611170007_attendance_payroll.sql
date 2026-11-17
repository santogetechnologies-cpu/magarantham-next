alter table public.payroll_runs add column monthly_allowances jsonb not null default '[]';
alter table public.payroll_runs add column monthly_deductions jsonb not null default '[]';
create function private.validate_salary_policy(d jsonb) returns void language plpgsql immutable set search_path='' as $$
declare a jsonb; b jsonb; previous_to numeric:=0;
begin
 if jsonb_typeof(d->'work_weekdays')<>'array' or jsonb_array_length(d->'work_weekdays') not between 1 and 7 or exists(select 1 from jsonb_array_elements_text(d->'work_weekdays')x where x::int not between 0 and 6) or (select count(distinct value) from jsonb_array_elements_text(d->'work_weekdays'))<>jsonb_array_length(d->'work_weekdays') then raise exception 'INVALID_WORK_WEEK'; end if;
 if mod((d->>'paid_leave_units')::numeric,0.5)<>0 or jsonb_typeof(d->'leave_tiers')<>'array' or jsonb_array_length(d->'leave_tiers')>62 then raise exception 'INVALID_LEAVE_TIERS'; end if;
 for a in select value from jsonb_array_elements(d->'leave_tiers') order by (value->>'from_unit')::numeric loop
  if (a->>'from_unit')::numeric<0.5 or (a->>'to_unit')::numeric>31 or (a->>'from_unit')::numeric>(a->>'to_unit')::numeric or (a->>'from_unit')::numeric<=previous_to or mod((a->>'from_unit')::numeric,0.5)<>0 or mod((a->>'to_unit')::numeric,0.5)<>0 or (a->>'lop_bps')::int not between 0 and 10000 then raise exception 'INVALID_LEAVE_TIERS'; end if;
  previous_to:=(a->>'to_unit')::numeric;
 end loop;
end $$;
create or replace function public.save_employee(p_actor uuid,p_id uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare key uuid:=coalesce(p_id,gen_random_uuid()); old public.employees;
begin
 perform private.require_super(p_actor);perform pg_advisory_xact_lock(761117020); perform private.pay_components(p_data->'allowances'); perform private.pay_components(p_data->'deductions');
 if (p_data->>'ended_on')::date<(p_data->>'joined_on')::date or not exists(select 1 from public.salary_policies where id=(p_data->>'policy_id')::uuid and active) then raise exception 'INVALID_EMPLOYMENT'; end if;
 select * into old from public.employees where id=key for update;
 insert into public.employees(id,code,name,employment,pay_basis,rate_paise,scheduled_units,overtime_rate_paise,allowances,deductions,active,phone,joined_on,ended_on,daily_minutes,policy_id)
 select key,x.code,x.name,x.employment,x.pay_basis,x.rate_paise,x.scheduled_units,x.overtime_rate_paise,x.allowances,x.deductions,x.active,x.phone,x.joined_on,x.ended_on,x.daily_minutes,x.policy_id from jsonb_populate_record(null::public.employees,p_data)x
 on conflict(id)do update set code=excluded.code,name=excluded.name,employment=excluded.employment,pay_basis=excluded.pay_basis,rate_paise=excluded.rate_paise,scheduled_units=excluded.scheduled_units,overtime_rate_paise=excluded.overtime_rate_paise,allowances=excluded.allowances,deductions=excluded.deductions,active=excluded.active,phone=excluded.phone,joined_on=excluded.joined_on,ended_on=excluded.ended_on,daily_minutes=excluded.daily_minutes,policy_id=excluded.policy_id,updated_at=now();
 perform private.audit(p_actor,'employee.saved','employees',key::text); return key;
end $$;
create function public.employee_link(p_actor uuid,p_employee uuid,p_profile uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_super(p_actor);perform pg_advisory_xact_lock(761117020);
 perform 1 from public.employees where id=p_employee and active for update;
 if not found or not exists(select 1 from public.profiles where id=p_profile and role::text in ('billing','manager')) then raise exception 'INVALID_EMPLOYEE_LOGIN'; end if;
 if exists(select 1 from public.employees where id=p_employee and profile_id is not null and profile_id<>p_profile) then raise exception 'LOGIN_ALREADY_LINKED'; end if;
 update public.employees set profile_id=p_profile where id=p_employee;
 update public.profiles set permissions=case when role::text='billing' then array['pos'] else permissions end where id=p_profile;
 perform private.audit(p_actor,'employee.login_linked','employees',p_employee::text,jsonb_build_object('profile_id',p_profile));
end $$;
create function public.attendance_save(p_actor uuid,p_employee uuid,p_on date,p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
declare e public.employees; month_start date:=date_trunc('month',p_on)::date; worked int; permission int; overtime int;
begin
 if not private.can_actor(p_actor,'attendance') then raise exception 'FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtext('payroll:'||p_employee::text||month_start::text));
 if exists(select 1 from public.payroll_runs where employee_id=p_employee and payroll_runs.period=month_start and status<>'draft') then raise exception 'PAYROLL_LOCKED'; end if;
 select * into e from public.employees where id=p_employee for share;
 if not found or p_on<e.joined_on or (e.ended_on is not null and p_on>e.ended_on) or p_on>(now() at time zone 'Asia/Kolkata')::date then raise exception 'INVALID_ATTENDANCE_DATE'; end if;
 permission:=case when p_data->>'status'='permission' then (p_data->>'permission_minutes')::int else 0 end;
 overtime:=(p_data->>'overtime_minutes')::int;
 worked:=case p_data->>'status' when 'full_day' then (p_data->>'worked_minutes')::int when 'half_day' then (p_data->>'worked_minutes')::int when 'permission' then e.daily_minutes-permission else 0 end;
 if worked<0 or worked>e.daily_minutes or permission>e.daily_minutes or (p_data->>'status'='permission' and permission<=0) or (p_data->>'status'='half_day' and worked>e.daily_minutes/2) or (p_data->>'status' not in ('full_day','half_day','permission') and overtime<>0) then raise exception 'INVALID_ATTENDANCE_UNITS'; end if;
 insert into public.attendance(employee_id,work_on,status,leave_units,permission_minutes,worked_minutes,overtime_minutes,note,marked_by)
 values(p_employee,p_on,p_data->>'status',(p_data->>'leave_units')::numeric,permission,worked,overtime,coalesce(p_data->>'note',''),p_actor)
 on conflict(employee_id,work_on)do update set status=excluded.status,leave_units=excluded.leave_units,permission_minutes=excluded.permission_minutes,worked_minutes=excluded.worked_minutes,overtime_minutes=excluded.overtime_minutes,note=excluded.note,marked_by=excluded.marked_by,updated_at=now();
 perform private.audit(p_actor,'attendance.saved','employees',p_employee::text,jsonb_build_object('date',p_on,'status',p_data->>'status'));
end $$;
create function private.payroll_calculation(p_employee uuid,p_period date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e public.employees; pol public.salary_policies; day date; last_day date; a public.attendance; days jsonb:='[]'; expected boolean; active_day boolean;
 divisor numeric:=0; eligible numeric:=0; paid numeric:=0; lost numeric:=0; paid_minutes numeric:=0; expected_minutes numeric:=0; ot_minutes numeric:=0;
 permission_used int:=0; excess int; quota int; day_paid numeric; day_lop numeric; leave_ordinal numeric:=0; total_leaves numeric:=0; half numeric; rate int; tier jsonb; base bigint; lop bigint; ot bigint;
begin
 if extract(day from p_period)<>1 then raise exception 'PERIOD_MUST_START_ON_FIRST'; end if;
 last_day:=(p_period+interval '1 month -1 day')::date;
 if last_day>=(now() at time zone 'Asia/Kolkata')::date then raise exception 'PAYROLL_MONTH_NOT_CLOSED'; end if;
 select * into e from public.employees where id=p_employee;
 if not found or e.joined_on>last_day or (e.ended_on is not null and e.ended_on<p_period) then raise exception 'NO_EMPLOYMENT_IN_PERIOD'; end if;
 select * into pol from public.salary_policies where id=e.policy_id;
 if not found then raise exception 'SALARY_POLICY_REQUIRED'; end if;
 select coalesce(sum(leave_units),0) into total_leaves from public.attendance where employee_id=p_employee and work_on between greatest(p_period,e.joined_on) and least(last_day,coalesce(e.ended_on,last_day)) and status='leave';
 for day in select generate_series(p_period,last_day,interval '1 day')::date loop
  expected:=extract(dow from day)::int=any(pol.work_weekdays);
  if (pol.divisor_mode='calendar' or expected) then divisor:=divisor+1; end if;
  active_day:=day>=e.joined_on and (e.ended_on is null or day<=e.ended_on);
  if not active_day then continue; end if;
  select * into a from public.attendance where employee_id=p_employee and work_on=day;
  if not found then
   if expected then raise exception 'MISSING_ATTENDANCE: %',day; end if;
   a.status:='weekly_off';a.worked_minutes:=0;a.overtime_minutes:=0;
  end if;
  if not expected and pol.divisor_mode='scheduled' then
   -- Work on a weekly off is paid through explicitly marked overtime, avoiding a second base day.
   ot_minutes:=ot_minutes+coalesce(a.overtime_minutes,0);
   days:=days||jsonb_build_array(jsonb_build_object('date',day,'status',a.status,'paid_units',0,'lop_units',0,'overtime_minutes',coalesce(a.overtime_minutes,0))); continue;
  end if;
  eligible:=eligible+1;expected_minutes:=expected_minutes+e.daily_minutes;day_paid:=1;day_lop:=0;
  case a.status
   when 'full_day' then if e.pay_basis='hourly' then day_paid:=a.worked_minutes::numeric/e.daily_minutes; end if;
   when 'half_day' then day_paid:=case when e.pay_basis='hourly' then a.worked_minutes::numeric/e.daily_minutes else pol.half_day_pay_bps::numeric/10000 end;
   when 'absent' then day_paid:=0;
   when 'weekly_off' then day_paid:=case when e.pay_basis='monthly' then 1 else 0 end;
   when 'holiday' then day_paid:=case when pol.holiday_paid then 1 else 0 end;
   when 'permission' then
    quota:=greatest(0,pol.paid_permission_minutes-permission_used);excess:=greatest(0,a.permission_minutes-quota);permission_used:=permission_used+a.permission_minutes;
    day_paid:=case when excess=0 then 1 when pol.permission_lop='half_day' then .5 when pol.permission_lop='full_day' then 0 else 1-excess::numeric/e.daily_minutes end;
   when 'leave' then
    day_paid:=1;
    for half in select generate_series(0.5,a.leave_units,0.5) loop
     leave_ordinal:=leave_ordinal+.5;rate:=pol.default_leave_lop_bps;
     if leave_ordinal<=pol.paid_leave_units then rate:=0;
     else
      select value into tier from jsonb_array_elements(pol.leave_tiers) where (case when pol.leave_rule_mode='monthly_total' then total_leaves else leave_ordinal end) between (value->>'from_unit')::numeric and (value->>'to_unit')::numeric limit 1;
      if found then rate:=(tier->>'lop_bps')::int; end if;
     end if;
     day_paid:=day_paid-.5*rate/10000;
    end loop;
   else raise exception 'INVALID_ATTENDANCE_STATUS';
  end case;
  day_lop:=1-day_paid;paid:=paid+day_paid;lost:=lost+day_lop;paid_minutes:=paid_minutes+day_paid*e.daily_minutes;ot_minutes:=ot_minutes+coalesce(a.overtime_minutes,0);
  days:=days||jsonb_build_array(jsonb_build_object('date',day,'status',a.status,'paid_units',round(day_paid,6),'lop_units',round(day_lop,6),'permission_minutes',coalesce(a.permission_minutes,0),'overtime_minutes',coalesce(a.overtime_minutes,0),'note',coalesce(a.note,'')));
 end loop;
 if divisor<=0 then raise exception 'INVALID_SALARY_DIVISOR'; end if;
 base:=case e.pay_basis when 'monthly' then round(e.rate_paise::numeric*eligible/divisor)::bigint when 'daily' then round(e.rate_paise::numeric*eligible)::bigint else round(e.rate_paise::numeric*expected_minutes/60)::bigint end;
 lop:=case e.pay_basis when 'monthly' then round(e.rate_paise::numeric*lost/divisor)::bigint when 'daily' then round(e.rate_paise::numeric*lost)::bigint else round(e.rate_paise::numeric*(expected_minutes-paid_minutes)/60)::bigint end;
 ot:=round(e.overtime_rate_paise::numeric*ot_minutes/60)::bigint;
 return jsonb_build_object('employee',to_jsonb(e),'policy',to_jsonb(pol),'period',p_period,'period_divisor',divisor,'eligible_units',eligible,'paid_units',round(paid,6),'lop_units',round(lost,6),'overtime_hours',round(ot_minutes/60,6),'base_paise',base,'lop_paise',lop,'earned_base_paise',base-lop,'overtime_paise',ot,'days',days);
end $$;
create function public.payroll_preview(p_actor uuid,p_employee uuid,p_period date) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.require_super(p_actor);perform pg_advisory_xact_lock(761117020);return private.payroll_calculation(p_employee,p_period);end $$;
create function public.payroll_from_attendance(p_actor uuid,p_employee uuid,p_period date,p_bonus bigint,p_allowances jsonb,p_deductions jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare calc jsonb; e public.employees; old public.payroll_runs; key uuid; allowance bigint; deduction bigint; gross bigint; extras_a jsonb; extras_d jsonb;
begin
 perform private.require_super(p_actor);perform pg_advisory_xact_lock(761117020);perform pg_advisory_xact_lock(hashtext('payroll:'||p_employee::text||p_period::text));
 select * into e from public.employees where id=p_employee for share;
 select * into old from public.payroll_runs where employee_id=p_employee and period=p_period for update;
 if found and old.status<>'draft' then raise exception 'PAYROLL_LOCKED'; end if;
 if p_bonus not between 0 and 100000000 then raise exception 'INVALID_BONUS'; end if;
 calc:=private.payroll_calculation(p_employee,p_period);
 extras_a:=e.allowances||p_allowances; extras_d:=e.deductions||p_deductions;
 allowance:=private.pay_components(extras_a)+p_bonus;deduction:=private.pay_components(extras_d);
 gross:=(calc->>'earned_base_paise')::bigint+(calc->>'overtime_paise')::bigint+allowance;
 if deduction>gross or gross>2000000000 then raise exception 'INVALID_NET_PAY'; end if;
 key:=coalesce(old.id,gen_random_uuid());
 insert into public.payroll_runs(id,employee_id,period,employee_snapshot,worked_units,overtime_units,allowances,deductions,base_paise,overtime_paise,allowance_paise,deduction_paise,gross_paise,net_paise,created_by,calculation,calculation_hash,bonus_paise)
 values(key,e.id,p_period,to_jsonb(e),(calc->>'paid_units')::numeric,(calc->>'overtime_hours')::numeric,extras_a,extras_d,(calc->>'earned_base_paise')::bigint,(calc->>'overtime_paise')::bigint,allowance,deduction,gross,gross-deduction,p_actor,calc,encode(sha256(convert_to(calc::text,'UTF8')),'hex'),p_bonus)
 on conflict(id)do update set employee_snapshot=excluded.employee_snapshot,worked_units=excluded.worked_units,overtime_units=excluded.overtime_units,allowances=excluded.allowances,deductions=excluded.deductions,base_paise=excluded.base_paise,overtime_paise=excluded.overtime_paise,allowance_paise=excluded.allowance_paise,deduction_paise=excluded.deduction_paise,gross_paise=excluded.gross_paise,net_paise=excluded.net_paise,calculation=excluded.calculation,calculation_hash=excluded.calculation_hash,bonus_paise=excluded.bonus_paise,updated_at=now();
 update public.payroll_runs set monthly_allowances=p_allowances,monthly_deductions=p_deductions where id=key;
 perform private.audit(p_actor,'payroll.drafted_from_attendance','payroll_runs',key::text);return key;
end $$;
create function public.payroll_finalize(p_actor uuid,p_run uuid,p_action text,p_reference text,p_method text,p_checked boolean) returns void language plpgsql security definer set search_path='' as $$
declare r public.payroll_runs; calc jsonb; category uuid;
begin
 perform private.require_super(p_actor);perform pg_advisory_xact_lock(761117020);
 select * into r from public.payroll_runs where id=p_run;
 if not found then raise exception 'NOT_FOUND'; end if;
 perform pg_advisory_xact_lock(hashtext('payroll:'||r.employee_id::text||r.period::text));
 select * into r from public.payroll_runs where id=p_run for update;
 if p_action='approve' then
  if r.status in ('approved','paid') then return; end if;
  calc:=private.payroll_calculation(r.employee_id,r.period);
  if r.calculation_hash is null or r.calculation_hash<>encode(sha256(convert_to(calc::text,'UTF8')),'hex') then raise exception 'PAYROLL_STALE'; end if;
  update public.payroll_runs set status='approved',approved_by=p_actor,approved_at=now(),updated_at=now() where id=p_run;
 elsif p_action='paid' then
  if r.status='paid' then if r.payment_reference<>p_reference or r.payment_method<>p_method then raise exception 'IDEMPOTENCY_CONFLICT'; end if;return;end if;
  if r.status<>'approved' or not p_checked or length(trim(p_reference)) not between 6 and 100 or p_method not in ('cash','upi','card','bank') then raise exception 'PAYROLL_PAYMENT_REQUIRED';end if;
  update public.payroll_runs set status='paid',paid_by=p_actor,paid_at=now(),payment_reference=p_reference,payment_method=p_method,updated_at=now() where id=p_run;
  select id into category from public.expense_categories where name='Payroll';
  if category is null then insert into public.expense_categories(name) values('Payroll') returning id into category;end if;
  if r.net_paise>0 then insert into public.expenses(request_key,fingerprint,category_id,expense_on,description,amount_paise,method,reference,payee,source,payroll_id,actor_id)
  values(p_run,'payroll:'||p_run::text,category,(now() at time zone 'Asia/Kolkata')::date,'Salary '||r.period::text,r.net_paise,p_method,p_reference,r.employee_snapshot->>'name','payroll',p_run,p_actor) on conflict(payroll_id)do nothing;end if;
 else raise exception 'INVALID_STATUS_CHANGE';end if;
 perform private.audit(p_actor,'payroll.'||p_action,'payroll_runs',p_run::text);
end $$;
-- Older manual-worked-units payroll paths cannot bypass attendance or month locks.
revoke all on function public.payroll_draft(uuid,uuid,date,numeric,numeric,jsonb,jsonb),public.payroll_post(uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on all functions in schema private from public,anon,authenticated;
do $$ declare r record;begin for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('erp_save','purchase_save','purchase_status','purchase_receive','purchase_pay','purchase_balances','expense_post','expense_void','employee_link','attendance_save','payroll_preview','payroll_from_attendance','payroll_finalize') loop
 execute format('revoke all on function %s from public,anon,authenticated',r.signature); execute format('grant execute on function %s to service_role',r.signature);end loop;end $$;
