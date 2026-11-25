-- =====================================================================
-- Gestione turni - Fase 3: cambi turno
-- =====================================================================

create or replace function public.is_shift_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin', 'admin_shifts'), false)
$$;

create or replace function public.today_rome()
returns date language sql stable as $$
  select (now() at time zone 'Europe/Rome')::date
$$;

create table public.swap_requests (
  id                bigint generated always as identity primary key,
  date              date   not null,
  requester_id      uuid   not null references public.profiles(id) on delete cascade,
  requester_email   text   not null references public.people(email) on update cascade,
  requester_type_id bigint not null references public.shift_types(id),
  target_id         uuid   not null references public.profiles(id) on delete cascade,
  target_email      text   not null references public.people(email) on update cascade,
  target_type_id    bigint not null references public.shift_types(id),
  message           text,
  response          text,
  status            text   not null default 'pending'
                    check (status in ('pending', 'accepted', 'rejected', 'cancelled', 'expired')),
  requester_seen    boolean not null default true,
  created_at        timestamptz not null default now(),
  responded_at      timestamptz
);
create index swap_requests_target_idx on public.swap_requests (target_id, status);
create index swap_requests_requester_idx on public.swap_requests (requester_id, status);
create index swap_requests_date_idx on public.swap_requests (date);

alter table public.swap_requests enable row level security;
create policy swap_requests_select on public.swap_requests for select to authenticated
  using (requester_id = auth.uid() or target_id = auth.uid());
revoke all on public.swap_requests from anon, authenticated;
grant select on public.swap_requests to authenticated;

-- Imposta un nuovo tipo di turno ricordando quello originale (dal CSV)
create or replace function public._set_shift_type(p_shift_id bigint, p_new_type bigint)
returns void language plpgsql security definer set search_path = public as $$
declare s public.shifts; v_orig bigint;
begin
  select * into s from public.shifts where id = p_shift_id;
  v_orig := coalesce(s.original_shift_type_id, s.shift_type_id);
  update public.shifts
     set shift_type_id = p_new_type,
         original_shift_type_id = case when v_orig = p_new_type then null else v_orig end,
         changed = (v_orig <> p_new_type),
         updated_at = now()
   where id = p_shift_id;
end $$;

-- Scambia i turni di due persone nello stesso giorno
create or replace function public._apply_swap(p_date date, p_a text, p_b text)
returns void language plpgsql security definer set search_path = public as $$
declare sa public.shifts; sb public.shifts;
begin
  select * into sa from public.shifts where date = p_date and email = p_a for update;
  select * into sb from public.shifts where date = p_date and email = p_b for update;
  if sa.id is null or sb.id is null then
    raise exception 'Uno dei due non ha un turno in questo giorno';
  end if;
  perform public._set_shift_type(sa.id, sb.shift_type_id);
  perform public._set_shift_type(sb.id, sa.shift_type_id);

  -- le altre richieste in attesa che coinvolgono queste persone in quel giorno non sono più valide
  update public.swap_requests
     set status = 'expired', responded_at = now(), requester_seen = false
   where date = p_date and status = 'pending'
     and (requester_email in (p_a, p_b) or target_email in (p_a, p_b));
end $$;

-- Se un turno viene cancellato (es. nuovo CSV) le richieste in attesa decadono
create or replace function public.expire_requests_on_shift_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.swap_requests
     set status = 'expired', responded_at = now(), requester_seen = false
   where status = 'pending' and date = old.date
     and (requester_email = old.email or target_email = old.email);
  return old;
end $$;

create trigger shifts_expire_requests
  after delete on public.shifts
  for each row execute function public.expire_requests_on_shift_delete();

-- ---------------------------------------------------------------------
-- RPC per gli utenti
-- ---------------------------------------------------------------------

create or replace function public.create_swap_request(p_date date, p_target_email text, p_message text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare me public.profiles; tgt public.profiles; v_my bigint; v_their bigint; v_id bigint;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'approved';
  if me.id is null then raise exception 'Non autorizzato'; end if;
  if p_date < public.today_rome() then raise exception 'Non puoi chiedere cambi per giorni passati'; end if;

  select * into tgt from public.profiles where email = lower(btrim(p_target_email)) and status = 'approved';
  if tgt.id is null then raise exception 'Questo collega non è ancora registrato nell''app'; end if;
  if tgt.id = me.id then raise exception 'Non puoi chiedere un cambio a te stesso'; end if;

  select shift_type_id into v_my from public.shifts where date = p_date and email = me.email;
  if v_my is null then raise exception 'Non hai un turno in questo giorno'; end if;
  select shift_type_id into v_their from public.shifts where date = p_date and email = tgt.email;
  if v_their is null then raise exception 'Il collega non ha un turno in questo giorno'; end if;
  if v_my = v_their then raise exception 'Avete lo stesso turno'; end if;

  if exists (select 1 from public.swap_requests
              where date = p_date and status = 'pending'
                and ((requester_id = me.id and target_id = tgt.id) or (requester_id = tgt.id and target_id = me.id))) then
    raise exception 'C''è già una richiesta in attesa con questo collega per questo giorno';
  end if;

  insert into public.swap_requests (date, requester_id, requester_email, requester_type_id,
                                    target_id, target_email, target_type_id, message)
  values (p_date, me.id, me.email, v_my, tgt.id, tgt.email, v_their, nullif(btrim(p_message), ''))
  returning id into v_id;
  return v_id;
end $$;

-- Risposta del collega: restituisce 'accepted', 'rejected' oppure 'expired'
create or replace function public.respond_swap(p_id bigint, p_accept boolean, p_response text default null)
returns text language plpgsql security definer set search_path = public as $$
declare r public.swap_requests; v_a bigint; v_b bigint;
begin
  select * into r from public.swap_requests where id = p_id for update;
  if r.id is null or r.target_id <> auth.uid() then raise exception 'Richiesta non trovata'; end if;
  if r.status <> 'pending' then raise exception 'Questa richiesta non è più in attesa'; end if;

  if not p_accept then
    update public.swap_requests
       set status = 'rejected', response = nullif(btrim(p_response), ''), responded_at = now(), requester_seen = false
     where id = p_id;
    return 'rejected';
  end if;

  select shift_type_id into v_a from public.shifts where date = r.date and email = r.requester_email;
  select shift_type_id into v_b from public.shifts where date = r.date and email = r.target_email;
  if v_a is distinct from r.requester_type_id or v_b is distinct from r.target_type_id then
    update public.swap_requests
       set status = 'expired', response = nullif(btrim(p_response), ''), responded_at = now(), requester_seen = false
     where id = p_id;
    return 'expired';
  end if;

  update public.swap_requests
     set status = 'accepted', response = nullif(btrim(p_response), ''), responded_at = now(), requester_seen = false
   where id = p_id;
  perform public._apply_swap(r.date, r.requester_email, r.target_email);
  return 'accepted';
end $$;

create or replace function public.cancel_swap(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.swap_requests set status = 'cancelled', responded_at = now()
   where id = p_id and requester_id = auth.uid() and status = 'pending';
  if not found then raise exception 'Richiesta non trovata o non più in attesa'; end if;
end $$;

create or replace function public.mark_swaps_seen()
returns void language sql security definer set search_path = public as $$
  update public.swap_requests set requester_seen = true
   where requester_id = auth.uid() and requester_seen = false
$$;

-- ---------------------------------------------------------------------
-- RPC per gli admin
-- ---------------------------------------------------------------------

-- Admin completo e admin cambi turno: registra uno scambio tra due persone
create or replace function public.admin_swap(p_date date, p_a text, p_b text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_shift_admin() then raise exception 'Operazione riservata agli admin'; end if;
  if lower(btrim(p_a)) = lower(btrim(p_b)) then raise exception 'Scegli due persone diverse'; end if;
  perform public._apply_swap(p_date, lower(btrim(p_a)), lower(btrim(p_b)));
end $$;

-- Solo admin completo: cambia direttamente il turno di una persona
create or replace function public.admin_set_shift(p_date date, p_email text, p_type_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_email text := lower(btrim(p_email));
begin
  if not public.is_admin() then raise exception 'Operazione riservata agli admin completi'; end if;
  select id into v_id from public.shifts where date = p_date and email = v_email for update;
  if v_id is null then raise exception 'Questa persona non ha un turno in questo giorno'; end if;
  perform public._set_shift_type(v_id, p_type_id);
  update public.swap_requests
     set status = 'expired', responded_at = now(), requester_seen = false
   where date = p_date and status = 'pending' and (requester_email = v_email or target_email = v_email);
end $$;

-- Email dei colleghi registrati e approvati (per sapere a chi si può chiedere un cambio)
create or replace function public.registered_emails()
returns setof text language sql stable security definer set search_path = public as $$
  select email from public.profiles where status = 'approved' and public.is_approved()
$$;
revoke execute on function public.registered_emails() from public, anon;
grant execute on function public.registered_emails() to authenticated;

-- ---------------------------------------------------------------------
-- Permessi sulle funzioni
-- ---------------------------------------------------------------------
revoke execute on function
  public._set_shift_type(bigint, bigint),
  public._apply_swap(date, text, text),
  public.expire_requests_on_shift_delete()
from public, anon, authenticated;

revoke execute on function
  public.is_shift_admin(),
  public.create_swap_request(date, text, text),
  public.respond_swap(bigint, boolean, text),
  public.cancel_swap(bigint),
  public.mark_swaps_seen(),
  public.admin_swap(date, text, text),
  public.admin_set_shift(date, text, bigint)
from public, anon;

grant execute on function
  public.is_shift_admin(),
  public.create_swap_request(date, text, text),
  public.respond_swap(bigint, boolean, text),
  public.cancel_swap(bigint),
  public.mark_swaps_seen(),
  public.admin_swap(date, text, text),
  public.admin_set_shift(date, text, bigint)
to authenticated;
