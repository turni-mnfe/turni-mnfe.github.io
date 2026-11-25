-- =====================================================================
-- Gestione turni - Fase 2: impostazioni personali di ogni utente
-- =====================================================================

create table public.user_settings (
  user_id           uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  font_scale        numeric not null default 1 check (font_scale between 0.7 and 2),
  highlight_changed boolean not null default true,
  changed_color     text    not null default '#1e88e5',
  type_prefs        jsonb   not null default '{}'::jsonb,  -- {"<shift_type_id>": {"color": "#...", "label": "..."}}
  type_order        jsonb   not null default '[]'::jsonb,  -- [shift_type_id, ...] ordine personale
  updated_at        timestamptz not null default now()
);

alter table public.user_settings enable row level security;

create policy user_settings_select on public.user_settings for select to authenticated
  using (user_id = auth.uid());
create policy user_settings_insert on public.user_settings for insert to authenticated
  with check (user_id = auth.uid());
create policy user_settings_update on public.user_settings for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.user_settings from anon, authenticated;
grant select, insert, update on public.user_settings to authenticated;
