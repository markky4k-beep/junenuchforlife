alter table public.users
  add column if not exists bound_store_id text not null default '';

create index if not exists idx_users_bound_store_id
  on public.users(bound_store_id);
