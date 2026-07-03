create table if not exists public.store_databases (
  store_id text primary key references public.stores(id) on delete cascade,
  database_key text not null unique,
  provider text not null default 'supabase',
  schema_name text not null default 'public',
  namespace text not null,
  status text not null default 'ready',
  tenant_tables jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at bigint not null,
  updated_at bigint not null
);

create index if not exists idx_store_databases_status_created_at
  on public.store_databases(status, created_at desc);

insert into public.store_databases (
  store_id, database_key, provider, schema_name, namespace, status, tenant_tables, metadata, created_at, updated_at
)
select
  s.id,
  'db_' || regexp_replace(lower(s.id), '[^a-z0-9_]+', '_', 'g'),
  'supabase',
  'public',
  s.id,
  'ready',
  '["products","orders","reviews","leads","payment_logs","members","messages","articles","coupons","store_settings"]'::jsonb,
  jsonb_build_object('source', 'migration_004', 'isLogicalDatabase', true),
  coalesce(s.created_at, (extract(epoch from clock_timestamp()) * 1000)::bigint),
  (extract(epoch from clock_timestamp()) * 1000)::bigint
from public.stores s
on conflict (store_id) do update set
  database_key = excluded.database_key,
  provider = excluded.provider,
  schema_name = excluded.schema_name,
  namespace = excluded.namespace,
  status = 'ready',
  tenant_tables = excluded.tenant_tables,
  updated_at = excluded.updated_at;

comment on table public.store_databases is 'Logical per-store database registry. Data remains in shared Supabase tables and is isolated by store_id.';
