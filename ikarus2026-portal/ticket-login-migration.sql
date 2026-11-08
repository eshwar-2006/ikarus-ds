alter table public.profiles add column if not exists team_id uuid references public.teams(id) on delete set null;
create unique index if not exists profiles_team_identity_unique on public.profiles(team_id) where team_id is not null;
create index if not exists teams_ticket_lookup_idx on public.teams(lower(trim(registration_number)));
create table if not exists public.ticket_login_rate_limits (
 key text primary key,
 window_started_at timestamptz not null default now(),
 requests integer not null default 1
);
alter table public.ticket_login_rate_limits enable row level security;
revoke all on public.ticket_login_rate_limits from public,anon,authenticated;
create or replace function public.ikarus_ticket_rate_limit(p_key text,p_limit integer)
returns boolean language plpgsql security definer set search_path=public as $$
declare allowed_count integer;
begin
 insert into public.ticket_login_rate_limits as limits(key) values (p_key)
 on conflict (key) do update set
 requests=case when limits.window_started_at<now()-interval '5 minutes' then 1 else limits.requests+1 end,
 window_started_at=case when limits.window_started_at<now()-interval '5 minutes' then now() else limits.window_started_at end
 returning requests into allowed_count;
 return allowed_count<=p_limit;
end $$;
create or replace function public.ikarus_find_ticket(p_ticket text)
returns setof public.teams language sql stable security definer set search_path=public as $$
 select * from public.teams where lower(trim(registration_number))=lower(trim(p_ticket)) and status in ('registered','checked_in');
$$;
revoke all on function public.ikarus_find_ticket(text) from public,anon,authenticated;
revoke all on function public.ikarus_ticket_rate_limit(text,integer) from public,anon,authenticated;
grant execute on function public.ikarus_find_ticket(text) to service_role;
grant execute on function public.ikarus_ticket_rate_limit(text,integer) to service_role;
notify pgrst,'reload schema';
