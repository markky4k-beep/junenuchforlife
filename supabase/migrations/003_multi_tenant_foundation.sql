create extension if not exists pgcrypto;

create table if not exists public.stores (
  id text primary key,
  name text not null,
  slug text not null unique,
  subdomain text unique,
  status text not null default 'active',
  template_key text not null default 'default',
  primary_domain text not null default '',
  owner_user_id text not null default '',
  is_default boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at bigint not null,
  updated_at bigint not null
);

create index if not exists idx_stores_status_created_at
  on public.stores(status, created_at desc);

create unique index if not exists idx_stores_default_unique
  on public.stores(is_default)
  where is_default = true;

create table if not exists public.store_domains (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references public.stores(id) on delete cascade,
  host text not null unique,
  is_primary boolean not null default false,
  verified boolean not null default false,
  created_at bigint not null,
  updated_at bigint not null
);

create unique index if not exists idx_store_domains_primary_unique
  on public.store_domains(store_id, is_primary)
  where is_primary = true;

create index if not exists idx_store_domains_store_id
  on public.store_domains(store_id, host);

create table if not exists public.store_settings (
  store_id text not null references public.stores(id) on delete cascade,
  key text not null,
  value text not null default '',
  updated_at bigint not null,
  primary key (store_id, key)
);

create index if not exists idx_store_settings_store_key
  on public.store_settings(store_id, key);

create table if not exists public.user_store_roles (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users(id) on delete cascade,
  store_id text not null references public.stores(id) on delete cascade,
  role text not null default 'admin',
  created_at bigint not null,
  unique (user_id, store_id)
);

create index if not exists idx_user_store_roles_store_role
  on public.user_store_roles(store_id, role, created_at desc);

insert into public.stores (
  id, name, slug, subdomain, status, template_key, primary_domain, owner_user_id, is_default, metadata, created_at, updated_at
)
values (
  'store_main',
  'Junenuch For Life',
  'main',
  null,
  'active',
  'default',
  '',
  '',
  true,
  jsonb_build_object('source', 'migration_003'),
  (extract(epoch from clock_timestamp()) * 1000)::bigint,
  (extract(epoch from clock_timestamp()) * 1000)::bigint
)
on conflict (id) do update set
  slug = excluded.slug,
  template_key = excluded.template_key,
  is_default = true,
  updated_at = excluded.updated_at;

alter table public.products add column if not exists store_id text not null default 'store_main';
alter table public.product_collections add column if not exists store_id text not null default 'store_main';
alter table public.product_catalog add column if not exists store_id text not null default 'store_main';
alter table public.orders add column if not exists store_id text not null default 'store_main';
alter table public.reviews add column if not exists store_id text not null default 'store_main';
alter table public.leads add column if not exists store_id text not null default 'store_main';
alter table public.payment_logs add column if not exists store_id text not null default 'store_main';
alter table public.members add column if not exists store_id text not null default 'store_main';
alter table public.messages add column if not exists store_id text not null default 'store_main';
alter table public.user_sessions add column if not exists store_id text not null default 'store_main';
alter table public.web_bridge_sessions add column if not exists store_id text not null default 'store_main';
alter table public.web_bridge_messages add column if not exists store_id text not null default 'store_main';
alter table public.articles add column if not exists store_id text not null default 'store_main';
alter table public.coupons add column if not exists store_id text not null default 'store_main';

update public.products set store_id = 'store_main' where coalesce(store_id, '') = '';
update public.product_collections set store_id = 'store_main' where coalesce(store_id, '') = '';
update public.product_catalog set store_id = 'store_main' where coalesce(store_id, '') = '';
update public.orders set store_id = 'store_main' where coalesce(store_id, '') = '';
update public.reviews set store_id = 'store_main' where coalesce(store_id, '') = '';
update public.leads set store_id = 'store_main' where coalesce(store_id, '') = '';
update public.payment_logs set store_id = 'store_main' where coalesce(store_id, '') = '';
update public.members set store_id = 'store_main' where coalesce(store_id, '') = '';
update public.messages set store_id = 'store_main' where coalesce(store_id, '') = '';
update public.user_sessions set store_id = 'store_main' where coalesce(store_id, '') = '';
update public.web_bridge_sessions set store_id = 'store_main' where coalesce(store_id, '') = '';
update public.web_bridge_messages set store_id = 'store_main' where coalesce(store_id, '') = '';
update public.articles set store_id = 'store_main' where coalesce(store_id, '') = '';
update public.coupons set store_id = 'store_main' where coalesce(store_id, '') = '';

create index if not exists idx_products_store_active_sort
  on public.products(store_id, active, sort, created_at);
create index if not exists idx_product_collections_store_active_sort
  on public.product_collections(store_id, is_active, sort_order, created_at);
create index if not exists idx_product_catalog_store_collection_sort
  on public.product_catalog(store_id, collection_key, is_active, sort_order, created_at);
create index if not exists idx_orders_store_created_at
  on public.orders(store_id, created_at desc);
create index if not exists idx_reviews_store_product
  on public.reviews(store_id, product_id, created_at desc);
create index if not exists idx_leads_store_created_at
  on public.leads(store_id, created_at desc);
create index if not exists idx_messages_store_session
  on public.messages(store_id, session_id, at asc);
create index if not exists idx_articles_store_created_at
  on public.articles(store_id, created_at desc);
create index if not exists idx_coupons_store_code
  on public.coupons(store_id, code);

insert into public.user_store_roles (user_id, store_id, role, created_at)
select u.id, 'store_main', case when u.role in ('admin', 'chat_admin') then u.role else 'user' end, coalesce(u.created_at, (extract(epoch from clock_timestamp()) * 1000)::bigint)
from public.users u
on conflict (user_id, store_id) do nothing;

comment on table public.stores is 'Tenant/store registry for wildcard subdomain storefronts';
comment on table public.store_domains is 'Maps public hosts/subdomains to stores';
comment on table public.store_settings is 'Per-store override settings layered on top of global settings';
comment on table public.user_store_roles is 'Membership and role mapping for users across stores';
