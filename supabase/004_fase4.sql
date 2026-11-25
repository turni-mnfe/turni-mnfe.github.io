-- =====================================================================
-- Gestione turni - Fase 4: notifiche email e backup giornaliero
-- =====================================================================

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Le funzioni server (Edge Functions) usano il ruolo service_role: serve l'accesso alle tabelle
-- (il progetto è stato creato senza permessi automatici sulle nuove tabelle)
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

-- Preferenza notifiche di ogni utente: 'email' (badge + email), 'badge', 'none'
alter table public.user_settings
  add column notify_mode text not null default 'badge'
  check (notify_mode in ('email', 'badge', 'none'));

-- Impostazioni generali (una sola riga), gestite dagli admin
create table public.app_settings (
  id              int primary key default 1 check (id = 1),
  sender_email    text,
  sender_name     text not null default 'Turni MNFE',
  backup_enabled  boolean not null default false,
  backup_email    text,
  app_url         text not null default 'https://turni-mnfe.github.io/',
  last_backup_at  timestamptz,
  updated_at      timestamptz not null default now()
);
insert into public.app_settings (id) values (1);

alter table public.app_settings enable row level security;
create policy app_settings_select on public.app_settings for select to authenticated using (public.is_admin());
create policy app_settings_update on public.app_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to authenticated;
grant update (sender_email, sender_name, backup_enabled, backup_email, updated_at) on public.app_settings to authenticated;

-- Coda delle notifiche da inviare (letta solo dalla funzione "notify")
create table public.notification_queue (
  id         bigint generated always as identity primary key,
  kind       text not null,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  attempts   int not null default 0,
  error      text
);
alter table public.notification_queue enable row level security;
revoke all on public.notification_queue from anon, authenticated;

-- Sveglia la funzione "notify" (la chiamata parte dopo il commit)
create or replace function public._wake_notify()
returns void language sql security definer set search_path = public, extensions as $$
  select net.http_post(
    url     := 'https://hdhiioktuirmjnpcmhxb.supabase.co/functions/v1/notify',
    body    := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
$$;

create or replace function public._enqueue(p_kind text, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.notification_queue (kind, payload) values (p_kind, p_payload);
  perform public._wake_notify();
end $$;

-- Nuova richiesta di cambio
create or replace function public.tg_swap_request_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._enqueue('swap_request', jsonb_build_object('id', new.id));
  return new;
end $$;
create trigger swap_requests_notify_insert
  after insert on public.swap_requests
  for each row execute function public.tg_swap_request_insert();

-- Risposta a una richiesta
create or replace function public.tg_swap_request_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'pending' and new.status in ('accepted', 'rejected') then
    perform public._enqueue('swap_response', jsonb_build_object('id', new.id));
  end if;
  return new;
end $$;
create trigger swap_requests_notify_update
  after update of status on public.swap_requests
  for each row execute function public.tg_swap_request_update();

-- Nuovi turni caricati (gli inserimenti in shifts arrivano solo dal CSV)
create or replace function public.tg_shifts_loaded()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_from date; v_to date; v_n int;
begin
  select min(date), max(date), count(*) into v_from, v_to, v_n from new_rows;
  if v_n > 0 then
    perform public._enqueue('shifts_loaded', jsonb_build_object('from', v_from, 'to', v_to, 'count', v_n));
  end if;
  return null;
end $$;
create trigger shifts_notify_loaded
  after insert on public.shifts
  referencing new table as new_rows
  for each statement execute function public.tg_shifts_loaded();

revoke execute on function
  public._wake_notify(), public._enqueue(text, jsonb),
  public.tg_swap_request_insert(), public.tg_swap_request_update(), public.tg_shifts_loaded()
from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Attività programmate
-- ---------------------------------------------------------------------

-- Backup giornaliero alle 05:00 UTC (06:00 ora solare, 07:00 ora legale)
select cron.schedule('daily-backup', '0 5 * * *', $$
  select net.http_post(
    url     := 'https://hdhiioktuirmjnpcmhxb.supabase.co/functions/v1/daily-backup',
    body    := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb)
$$);

-- Riprova ogni 15 minuti le notifiche non ancora inviate
select cron.schedule('notify-retry', '*/15 * * * *', $$
  select net.http_post(
    url     := 'https://hdhiioktuirmjnpcmhxb.supabase.co/functions/v1/notify',
    body    := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb)
  where exists (select 1 from public.notification_queue where sent_at is null and attempts < 5)
$$);
