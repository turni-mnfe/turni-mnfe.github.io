-- =====================================================================
-- Gestione turni - Fase 1
-- Tabelle, funzioni e regole di sicurezza (RLS)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tabelle
-- ---------------------------------------------------------------------

-- Account registrati (uno per ogni utente di Supabase Auth)
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  first_name  text not null default '',
  last_name   text not null default '',
  status      text not null default 'pending'
              check (status in ('pending', 'approved', 'rejected')),
  role        text not null default 'user'
              check (role in ('user', 'admin_shifts', 'admin')),
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz
);

-- Persone presenti nei turni (registrate o no), con il nome visibile a tutti
create table public.people (
  email        text primary key,
  display_name text not null,
  updated_at   timestamptz not null default now()
);

-- Tipi di turno (nome per esteso come nel CSV)
create table public.shift_types (
  id          bigint generated always as identity primary key,
  name        text not null,
  name_key    text generated always as
              (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored unique,
  short_label text not null,
  sort_order  int  not null default 1000,
  category    text not null default 'presenza'
              check (category in ('presenza', 'assenza')),
  color       text not null default '#9e9e9e',
  created_at  timestamptz not null default now()
);

-- Turni: una riga per persona per giorno
create table public.shifts (
  id                     bigint generated always as identity primary key,
  date                   date   not null,
  email                  text   not null references public.people(email) on update cascade,
  shift_type_id          bigint not null references public.shift_types(id),
  original_shift_type_id bigint references public.shift_types(id) on delete set null,
  changed                boolean not null default false,
  updated_at             timestamptz not null default now(),
  unique (date, email)
);
create index shifts_email_date_idx on public.shifts (email, date);
create index shifts_date_idx on public.shifts (date);

-- ---------------------------------------------------------------------
-- Funzioni di supporto
-- ---------------------------------------------------------------------

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and status = 'approved'
$$;

create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'approved')
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

-- "mario.rossi@..." -> "Rossi"
create or replace function public.default_display_name(p_email text)
returns text language sql immutable as $$
  select initcap(replace(
    case when position('.' in split_part(p_email, '@', 1)) > 0
         then substring(split_part(p_email, '@', 1)
                        from position('.' in split_part(p_email, '@', 1)) + 1)
         else split_part(p_email, '@', 1) end,
    '.', ' '))
$$;

-- "Mattina 720" -> "M720", "Centrale Corto" -> "CC", "Riposo" -> "R"
create or replace function public.default_short_label(p_name text)
returns text language sql immutable as $$
  select coalesce(nullif(string_agg(
           case when w ~ '\d' then w
                else upper(left(regexp_replace(w, '[^[:alpha:]]', '', 'g'), 1)) end,
           '' order by ord), ''), left(btrim(p_name), 4))
  from regexp_split_to_table(btrim(p_name), '\s+') with ordinality as t(w, ord)
$$;

-- Colore e categoria iniziali per i nuovi tipi di turno
create or replace function public.shift_types_defaults()
returns trigger language plpgsql as $$
declare
  palette text[] := array['#f4c430','#4a90d9','#7cb342','#ef6c00','#8e24aa',
                          '#00897b','#d81b60','#5d4037','#3949ab','#c0ca33'];
begin
  if new.color = '#9e9e9e' then
    new.color := palette[1 + (new.id % array_length(palette, 1))];
  end if;
  if lower(new.name) ~ '(riposo|assen|ferie|permess|malatt|recuper|congedo|festiv)' then
    new.category := 'assenza';
    if new.sort_order = 1000 then new.sort_order := 2000; end if;
  end if;
  return new;
end $$;

create trigger shift_types_defaults
  before insert on public.shift_types
  for each row execute function public.shift_types_defaults();

-- Alla registrazione crea il profilo "in attesa"
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, first_name, last_name)
  values (new.id,
          lower(new.email),
          coalesce(btrim(new.raw_user_meta_data->>'first_name'), ''),
          coalesce(btrim(new.raw_user_meta_data->>'last_name'), ''));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Operazioni admin (RPC)
-- ---------------------------------------------------------------------

-- Approva o rifiuta un'iscrizione, impostando il nome visibile
create or replace function public.review_user(p_user uuid, p_approve boolean, p_display_name text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if not public.is_admin() then raise exception 'Operazione riservata agli admin'; end if;

  update public.profiles
     set status = case when p_approve then 'approved' else 'rejected' end,
         reviewed_at = now()
   where id = p_user
  returning email into v_email;

  if v_email is null then raise exception 'Utente non trovato'; end if;

  if p_approve then
    insert into public.people (email, display_name)
    values (v_email, coalesce(nullif(btrim(p_display_name), ''), public.default_display_name(v_email)))
    on conflict (email) do update
      set display_name = excluded.display_name, updated_at = now();
  end if;
end $$;

-- Cambia il nome visibile di una persona
create or replace function public.set_display_name(p_email text, p_display_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Operazione riservata agli admin'; end if;
  if nullif(btrim(p_display_name), '') is null then raise exception 'Il nome non può essere vuoto'; end if;
  insert into public.people (email, display_name)
  values (lower(btrim(p_email)), btrim(p_display_name))
  on conflict (email) do update set display_name = excluded.display_name, updated_at = now();
end $$;

-- Cambia il ruolo di un utente (non il proprio)
create or replace function public.set_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Operazione riservata agli admin'; end if;
  if p_user = auth.uid() then raise exception 'Non puoi cambiare il tuo ruolo'; end if;
  if p_role not in ('user', 'admin_shifts', 'admin') then raise exception 'Ruolo non valido'; end if;
  update public.profiles set role = p_role where id = p_user and status = 'approved';
  if not found then raise exception 'Utente non trovato o non approvato'; end if;
end $$;

-- Importa i turni dal CSV: sostituisce solo le date presenti nel file.
-- p_rows = [{"date":"2026-11-26","email":"...","shift":"Mattina 720"}, ...]
create or replace function public.import_shifts(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rows int; v_dates int; v_people int; v_min date; v_max date;
  v_new_types text[]; v_new_people int; v_deleted int;
begin
  if not public.is_admin() then raise exception 'Operazione riservata agli admin'; end if;

  drop table if exists pg_temp._imp;
  create temp table _imp on commit drop as
  select (r->>'date')::date                                    as date,
         lower(btrim(r->>'email'))                             as email,
         regexp_replace(btrim(r->>'shift'), '\s+', ' ', 'g')    as name
    from jsonb_array_elements(p_rows) r;

  if exists (select 1 from _imp where date is null or coalesce(email, '') = '' or coalesce(name, '') = '') then
    raise exception 'Ci sono righe incomplete';
  end if;
  if exists (select 1 from _imp group by date, email having count(*) > 1) then
    raise exception 'La stessa persona ha più turni nello stesso giorno';
  end if;

  select count(*), count(distinct date), count(distinct email), min(date), max(date)
    into v_rows, v_dates, v_people, v_min, v_max from _imp;

  -- Nuovi tipi di turno
  with nuovi as (
    select distinct on (lower(name)) name from _imp
     where lower(name) not in (select name_key from public.shift_types)
     order by lower(name), name
  ), ins as (
    insert into public.shift_types (name, short_label)
    select name, public.default_short_label(name) from nuovi
    returning name
  )
  select coalesce(array_agg(name), '{}') into v_new_types from ins;

  -- Nuove persone
  with ins as (
    insert into public.people (email, display_name)
    select distinct email, public.default_display_name(email) from _imp
    on conflict (email) do nothing
    returning 1
  )
  select count(*) into v_new_people from ins;

  -- Sostituzione delle date presenti nel file
  delete from public.shifts where date in (select distinct date from _imp);
  get diagnostics v_deleted = row_count;

  insert into public.shifts (date, email, shift_type_id)
  select i.date, i.email, t.id
    from _imp i join public.shift_types t on t.name_key = lower(i.name);

  return jsonb_build_object(
    'rows', v_rows, 'dates', v_dates, 'people', v_people,
    'from', v_min, 'to', v_max,
    'replaced', v_deleted,
    'new_shift_types', to_jsonb(v_new_types),
    'new_people', v_new_people);
end $$;

-- Esporta tutti i turni (per il download CSV)
create or replace function public.export_shifts(p_from date default null, p_to date default null)
returns table (date date, email text, shift text)
language sql stable security definer set search_path = public as $$
  select s.date, s.email, t.name
    from public.shifts s join public.shift_types t on t.id = s.shift_type_id
   where public.is_admin()
     and (p_from is null or s.date >= p_from)
     and (p_to   is null or s.date <= p_to)
   order by s.date, t.sort_order, t.name, s.email
$$;

-- ---------------------------------------------------------------------
-- Sicurezza: RLS e permessi
-- ---------------------------------------------------------------------

alter table public.profiles    enable row level security;
alter table public.people      enable row level security;
alter table public.shift_types enable row level security;
alter table public.shifts      enable row level security;

-- profiles: ognuno vede il proprio, gli admin vedono tutti
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- people / shift_types / shifts: visibili a tutti gli utenti approvati
create policy people_select on public.people for select to authenticated
  using (public.is_approved());
create policy shift_types_select on public.shift_types for select to authenticated
  using (public.is_approved());
create policy shifts_select on public.shifts for select to authenticated
  using (public.is_approved());

-- shift_types: gli admin possono modificare etichetta, ordine, categoria, colore
create policy shift_types_update on public.shift_types for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Permessi sulle tabelle (le scritture passano dalle funzioni RPC)
revoke all on public.profiles, public.people, public.shift_types, public.shifts from anon, authenticated;
grant select on public.profiles, public.people, public.shift_types, public.shifts to authenticated;
grant update (short_label, sort_order, category, color) on public.shift_types to authenticated;

-- Permessi sulle funzioni
revoke execute on function
  public.review_user(uuid, boolean, text),
  public.set_display_name(text, text),
  public.set_role(uuid, text),
  public.import_shifts(jsonb),
  public.export_shifts(date, date),
  public.my_role(), public.is_approved(), public.is_admin()
from public, anon;

grant execute on function
  public.review_user(uuid, boolean, text),
  public.set_display_name(text, text),
  public.set_role(uuid, text),
  public.import_shifts(jsonb),
  public.export_shifts(date, date),
  public.my_role(), public.is_approved(), public.is_admin()
to authenticated;
