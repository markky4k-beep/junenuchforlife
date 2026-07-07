create extension if not exists pgcrypto;

create table if not exists public.users (
  id text primary key,
  email text not null unique,
  name text not null default '',
  bound_store_id text not null default '',
  salt text not null,
  hash text not null,
  role text not null default 'user',
  bio text default '',
  line_id text default '',
  phone text default '',
  location text default '',
  created_at bigint not null
);

create table if not exists public.auth_tokens (
  token text primary key,
  user_id text not null,
  created_at bigint not null,
  expires_at bigint not null
);

create table if not exists public.settings (
  key text primary key,
  value text not null default ''
);

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

create table if not exists public.store_domains (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references public.stores(id) on delete cascade,
  host text not null unique,
  is_primary boolean not null default false,
  verified boolean not null default false,
  created_at bigint not null,
  updated_at bigint not null
);

create table if not exists public.store_settings (
  store_id text not null references public.stores(id) on delete cascade,
  key text not null,
  value text not null default '',
  updated_at bigint not null,
  primary key (store_id, key)
);

create table if not exists public.user_store_roles (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users(id) on delete cascade,
  store_id text not null references public.stores(id) on delete cascade,
  role text not null default 'admin',
  created_at bigint not null,
  unique (user_id, store_id)
);

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

create table if not exists public.products (
  store_id text not null default 'store_main',
  id text primary key,
  name text not null,
  tag text not null default '',
  price integer not null,
  short text not null default '',
  description text not null default '',
  specs jsonb not null default '{}'::jsonb,
  segment text not null default 'agri',
  extra jsonb not null default '{}'::jsonb,
  icon text not null default 'pod',
  image text not null default '',
  video text not null default '',
  images jsonb not null default '[]'::jsonb,
  model text not null default '',
  stock integer not null default 0,
  active boolean not null default true,
  sort integer not null default 0,
  created_at bigint not null,
  constraint products_non_negative_check check (price >= 0 and stock >= 0 and sort >= 0)
);

create table if not exists public.product_collections (
  store_id text not null default 'store_main',
  collection_key text primary key,
  display_name text not null,
  short_label text not null default '',
  subtitle text not null default '',
  hero_image_url text not null default '',
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.product_catalog (
  store_id text not null default 'store_main',
  product_id uuid primary key default gen_random_uuid(),
  collection_key text not null references public.product_collections(collection_key) on delete cascade,
  title text not null,
  description text not null default '',
  old_price numeric(12, 2) not null default 0,
  sale_price numeric(12, 2) not null default 0,
  image_url text not null default '',
  highlight_1 text not null default '',
  highlight_2 text not null default '',
  highlight_3 text not null default '',
  sort_order integer not null default 100,
  is_active boolean not null default true,
  web_product_id text references public.products(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (collection_key, title)
);

create table if not exists public.admin_product_drafts (
  store_id text not null default 'store_main',
  user_id text primary key,
  state text not null default '',
  collection_key text not null default '',
  title text not null default '',
  description text not null default '',
  image_url text not null default '',
  highlight_1 text not null default '',
  highlight_2 text not null default '',
  highlight_3 text not null default '',
  old_price numeric(12, 2) not null default 0,
  sale_price numeric(12, 2) not null default 0,
  product_id uuid,
  mode text not null default 'create',
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.admin_collection_drafts (
  store_id text not null default 'store_main',
  user_id text primary key,
  state text not null default '',
  mode text not null default 'create',
  original_key text not null default '',
  collection_key text not null default '',
  display_name text not null default '',
  short_label text not null default '',
  subtitle text not null default '',
  hero_image_url text not null default '',
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.articles (
  store_id text not null default 'store_main',
  id text primary key,
  title text not null,
  cover text not null default '',
  excerpt text not null default '',
  body text not null default '',
  published boolean not null default true,
  created_at bigint not null
);

create table if not exists public.coupons (
  store_id text not null default 'store_main',
  code text not null,
  type text not null,
  value integer not null,
  min_total integer not null default 0,
  max_uses integer not null default 0,
  used integer not null default 0,
  active boolean not null default true,
  expires_at bigint not null default 0,
  created_at bigint not null,
  constraint coupons_non_negative_check check (value >= 0 and min_total >= 0 and max_uses >= 0 and used >= 0)
);

create table if not exists public.orders (
  store_id text not null default 'store_main',
  id text primary key,
  items jsonb not null default '[]'::jsonb,
  total integer not null,
  subtotal integer not null default 0,
  discount integer not null default 0,
  shipping integer not null default 0,
  coupon text not null default '',
  customer jsonb not null default '{}'::jsonb,
  payment_method text not null,
  status text not null,
  paid boolean not null default false,
  payment_claimed boolean not null default false,
  tracking text not null default '',
  session_id text not null default '',
  stripe_session text not null default '',
  user_id text not null default '',
  channel text not null default 'web',
  line_user_id text not null default '',
  access_token text not null default '',
  resources_reserved boolean not null default false,
  created_at bigint not null,
  updated_at bigint not null
);

create table if not exists public.reviews (
  store_id text not null default 'store_main',
  id bigint generated by default as identity primary key,
  product_id text not null,
  user_id text not null,
  name text not null default '',
  rating integer not null,
  comment text not null default '',
  created_at bigint not null,
  constraint reviews_rating_range_check check (rating between 1 and 5)
);

create table if not exists public.leads (
  store_id text not null default 'store_main',
  id bigint generated by default as identity primary key,
  name text not null,
  phone text not null,
  line_id text not null default '',
  province text not null default '',
  crop text not null default '',
  stage text not null default '',
  area_rai text not null default '',
  problem text not null default '',
  source text not null default '',
  landing_page text not null default '',
  utm_source text not null default '',
  utm_medium text not null default '',
  utm_campaign text not null default '',
  note text not null default '',
  status text not null default 'new',
  created_at bigint not null,
  updated_at bigint not null
);

create table if not exists public.payment_logs (
  store_id text not null default 'store_main',
  order_id text primary key references public.orders(id) on delete cascade,
  user_id text not null default '',
  product text not null default '',
  amount numeric(12, 2) not null default 0,
  bank_name text not null default '',
  account_name text not null default '',
  account_number text not null default '',
  status text not null default '',
  slip_file_path text not null default '',
  slip_message_id text not null default '',
  slip_received_at text not null default '',
  verification_message text not null default '',
  verification_payload text not null default '',
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.members (
  store_id text not null default 'store_main',
  member_id text primary key,
  name text not null default '',
  phone text not null default '',
  province text not null default '',
  farm text not null default '',
  age text not null default '',
  source text not null default '',
  line_id text not null unique,
  display_name text not null default '',
  joined_date date not null default current_date
);

create table if not exists public.admin_access (
  store_id text not null default 'store_main',
  user_id text primary key,
  display_name text not null default '',
  granted_by text not null default '',
  key_name text not null default '',
  unlocked_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.messages (
  store_id text not null default 'store_main',
  id bigint generated by default as identity primary key,
  session_id text not null,
  sender text not null,
  text text not null,
  at bigint not null
);

create table if not exists public.user_sessions (
  store_id text not null default 'store_main',
  user_id text primary key,
  state text,
  product text not null default '',
  address text not null default '',
  payment text not null default '',
  order_id text not null default '',
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.web_bridge_sessions (
  store_id text not null default 'store_main',
  bridge_id uuid primary key default gen_random_uuid(),
  website_customer_id text not null default '',
  website_session_id text not null default '',
  website_webhook_url text not null default '',
  line_user_id text not null default '',
  line_display_name text not null default '',
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  last_message_at timestamptz,
  last_message_preview text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.web_bridge_messages (
  store_id text not null default 'store_main',
  message_id uuid primary key default gen_random_uuid(),
  bridge_id uuid not null references public.web_bridge_sessions(bridge_id) on delete cascade,
  direction text not null default 'line_to_website',
  sender_role text not null default 'customer',
  message_type text not null default 'text',
  content text not null default '',
  external_message_id text not null default '',
  delivery_status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.community_posts (
  store_id text not null default 'store_main',
  id text primary key,
  user_id text not null default '',
  author_name text not null default 'สมาชิก',
  author_avatar text not null default '',
  author_role text not null default 'member',
  caption text not null default '',
  media jsonb not null default '[]'::jsonb,
  hashtags jsonb not null default '[]'::jsonb,
  article_id text not null default '',
  product_ids jsonb not null default '[]'::jsonb,
  status text not null default 'pending',
  pinned boolean not null default false,
  created_at bigint not null default 0,
  updated_at bigint not null default 0
);

create table if not exists public.community_comments (
  store_id text not null default 'store_main',
  id text primary key,
  post_id text not null references public.community_posts(id) on delete cascade,
  user_id text not null default '',
  author_name text not null default 'สมาชิก',
  text text not null default '',
  status text not null default 'approved',
  created_at bigint not null default 0
);

create table if not exists public.community_reactions (
  store_id text not null default 'store_main',
  post_id text not null references public.community_posts(id) on delete cascade,
  user_id text not null,
  type text not null default 'like',
  created_at bigint not null default 0,
  primary key (post_id, user_id, type)
);

create table if not exists public.community_saves (
  store_id text not null default 'store_main',
  post_id text not null references public.community_posts(id) on delete cascade,
  user_id text not null,
  created_at bigint not null default 0,
  primary key (post_id, user_id)
);

create table if not exists public.community_stories (
  store_id text not null default 'store_main',
  id text primary key,
  post_id text not null default '',
  author_name text not null default 'Community',
  title text not null default '',
  media text not null default '',
  caption text not null default '',
  status text not null default 'approved',
  created_at bigint not null default 0,
  expires_at bigint not null default 0
);

create index if not exists idx_users_role_created_at
on public.users (role, created_at desc);
create index if not exists idx_auth_tokens_expires_at
on public.auth_tokens (expires_at asc);

create index if not exists idx_orders_created_at on public.orders (created_at desc);
create index if not exists idx_orders_user_id on public.orders (user_id);
create unique index if not exists idx_orders_access_token on public.orders (access_token);
create index if not exists idx_orders_channel on public.orders (channel, created_at desc);
create index if not exists idx_orders_line_user on public.orders (line_user_id);
create index if not exists idx_orders_store_created_at on public.orders (store_id, created_at desc);
create index if not exists idx_orders_expirable_pending
on public.orders (created_at asc)
where paid = false and payment_claimed = false and resources_reserved = true and status = 'awaiting_payment';
create index if not exists idx_orders_user_created_at on public.orders (user_id, created_at desc);

create index if not exists idx_messages_session_id on public.messages (session_id);
create index if not exists idx_messages_session_at on public.messages (session_id, at asc);
create index if not exists idx_messages_store_session on public.messages (store_id, session_id, at asc);

create index if not exists idx_products_active_sort on public.products (active, sort, created_at);
create index if not exists idx_products_store_active_sort on public.products (store_id, active, sort, created_at);

create index if not exists idx_product_catalog_collection_active
  on public.product_catalog(collection_key, is_active, sort_order, created_at);
create index if not exists idx_product_collections_store_active_sort
  on public.product_collections(store_id, is_active, sort_order, created_at);
create index if not exists idx_product_catalog_store_collection_sort
  on public.product_catalog(store_id, collection_key, is_active, sort_order, created_at);

create index if not exists idx_reviews_product_id on public.reviews (product_id, created_at desc);
create unique index if not exists idx_reviews_product_user on public.reviews (product_id, user_id);
create index if not exists idx_reviews_store_product on public.reviews (store_id, product_id, created_at desc);

create index if not exists idx_leads_created_at on public.leads (created_at desc);
create index if not exists idx_leads_store_created_at on public.leads (store_id, created_at desc);

create index if not exists idx_articles_published_created_at on public.articles (published, created_at desc);
create index if not exists idx_articles_store_created_at on public.articles (store_id, created_at desc);

create index if not exists idx_payment_logs_status on public.payment_logs (status);
create index if not exists idx_payment_logs_updated_at on public.payment_logs (updated_at desc);

create index if not exists idx_members_line_id on public.members (line_id);

create index if not exists idx_admin_access_unlocked_at on public.admin_access (unlocked_at desc);

create index if not exists idx_user_sessions_updated_at on public.user_sessions (updated_at desc);

create index if not exists idx_web_bridge_sessions_line_user_id on public.web_bridge_sessions(line_user_id);
create index if not exists idx_web_bridge_sessions_website_session_id on public.web_bridge_sessions(website_session_id);
create index if not exists idx_web_bridge_sessions_status_updated on public.web_bridge_sessions(status, updated_at desc);

create index if not exists idx_web_bridge_messages_bridge_created on public.web_bridge_messages(bridge_id, created_at asc);
create index if not exists idx_web_bridge_messages_delivery on public.web_bridge_messages(delivery_status, created_at desc);

create index if not exists idx_stores_status_created_at on public.stores(status, created_at desc);
create unique index if not exists idx_stores_default_unique
  on public.stores(is_default)
  where is_default = true;

create unique index if not exists idx_store_domains_primary_unique
  on public.store_domains(store_id, is_primary)
  where is_primary = true;
create index if not exists idx_store_domains_store_id
  on public.store_domains(store_id, host);

create index if not exists idx_store_settings_store_key
  on public.store_settings(store_id, key);

create index if not exists idx_user_store_roles_store_role
  on public.user_store_roles(store_id, role, created_at desc);

create index if not exists idx_store_databases_status_created_at
  on public.store_databases(status, created_at desc);

create index if not exists idx_coupons_store_code
  on public.coupons(store_id, code);
create unique index if not exists idx_coupons_store_code_unique
  on public.coupons(store_id, code);
create index if not exists idx_community_posts_store_status_created on public.community_posts (store_id, status, pinned desc, created_at desc);
create index if not exists idx_community_comments_store_post_created on public.community_comments (store_id, post_id, status, created_at);
create index if not exists idx_community_reactions_store_post on public.community_reactions (store_id, post_id, type);
create index if not exists idx_community_saves_store_post on public.community_saves (store_id, post_id);
create index if not exists idx_community_stories_store_expiry on public.community_stories (store_id, status, expires_at desc, created_at desc);

create or replace function public.reserve_order_resources(
  p_items jsonb default '[]'::jsonb,
  p_coupon text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  v_id text;
  v_qty integer;
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'รายการสินค้าไม่ถูกต้อง';
  end if;

  for item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_id := btrim(coalesce(item->>'id', ''));
    v_qty := greatest(1, coalesce((item->>'qty')::integer, 0));
    if v_id = '' then
      raise exception 'พบรายการสินค้าที่ไม่มีรหัส';
    end if;

    update public.products
       set stock = stock - v_qty
     where id = v_id
       and stock >= v_qty;
    if not found then
      raise exception 'สินค้า % คงเหลือไม่พอ', v_id;
    end if;
  end loop;

  if btrim(coalesce(p_coupon, '')) <> '' then
    update public.coupons
       set used = used + 1
     where code = upper(btrim(p_coupon))
       and active = true
       and (expires_at = 0 or expires_at > (extract(epoch from clock_timestamp()) * 1000)::bigint)
       and (max_uses = 0 or used < max_uses);
    if not found then
      raise exception 'คูปอง % ใช้งานไม่ได้แล้ว', upper(btrim(p_coupon));
    end if;
  end if;
end;
$$;

create or replace function public.release_order_resources(
  p_items jsonb default '[]'::jsonb,
  p_coupon text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  v_id text;
  v_qty integer;
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'รายการสินค้าไม่ถูกต้อง';
  end if;

  for item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_id := btrim(coalesce(item->>'id', ''));
    v_qty := greatest(1, coalesce((item->>'qty')::integer, 0));
    if v_id = '' then
      continue;
    end if;
    update public.products
       set stock = stock + v_qty
     where id = v_id;
  end loop;

  if btrim(coalesce(p_coupon, '')) <> '' then
    update public.coupons
       set used = greatest(0, used - 1)
     where code = upper(btrim(p_coupon));
  end if;
end;
$$;

create or replace function public.get_review_stats(p_product_id text default null)
returns table (
  product_id text,
  review_count bigint,
  review_avg numeric
)
language sql
stable
set search_path = public
as $$
  select
    r.product_id,
    count(*)::bigint as review_count,
    round(avg(r.rating)::numeric, 1) as review_avg
  from public.reviews r
  where p_product_id is null or r.product_id = p_product_id
  group by r.product_id;
$$;

create or replace function public.increment_coupon_use(p_code text)
returns void
language sql
set search_path = public
as $$
  update public.coupons
  set used = used + 1
  where code = upper(trim(coalesce(p_code, '')));
$$;

create or replace function public.get_admin_order_analytics(p_days integer default 30)
returns jsonb
language sql
stable
set search_path = public
as $$
with bounds as (
  select greatest(7, least(coalesce(p_days, 30), 90))::int as days
),
date_window as (
  select
    (date_trunc('day', timezone('utc', now()))::date - ((select days from bounds) - 1)) as start_day,
    date_trunc('day', timezone('utc', now()))::date as end_day
),
series_days as (
  select generate_series(
    (select start_day from date_window),
    (select end_day from date_window),
    interval '1 day'
  )::date as day
),
orders_window as (
  select *
  from public.orders
  where to_timestamp(created_at / 1000.0)::date >= (select start_day from date_window)
),
series as (
  select
    sd.day,
    count(ow.id)::int as orders,
    coalesce(sum(case when ow.paid then ow.total else 0 end), 0)::bigint as revenue
  from series_days sd
  left join orders_window ow
    on to_timestamp(ow.created_at / 1000.0)::date = sd.day
  group by sd.day
  order by sd.day
),
status_breakdown as (
  select coalesce(jsonb_object_agg(status, total), '{}'::jsonb) as data
  from (
    select status, count(*)::int as total
    from orders_window
    group by status
  ) t
),
payment_breakdown as (
  select jsonb_build_object(
    'promptpay', count(*) filter (where payment_method = 'promptpay'),
    'card', count(*) filter (where payment_method = 'card')
  ) as data
  from orders_window
),
top_products as (
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'revenue', revenue) order by qty desc, revenue desc, name asc), '[]'::jsonb) as data
  from (
    select
      item->>'name' as name,
      sum(coalesce((item->>'qty')::integer, 0))::int as qty,
      sum(coalesce((item->>'price')::integer, 0) * coalesce((item->>'qty')::integer, 0))::bigint as revenue
    from orders_window ow
    cross join lateral jsonb_array_elements(coalesce(ow.items, '[]'::jsonb)) item
    group by item->>'name'
    order by qty desc, revenue desc, name asc
    limit 5
  ) ranked
),
totals as (
  select jsonb_build_object(
    'revenue', coalesce(sum(case when paid then total else 0 end), 0)::bigint,
    'orders', count(*)::int,
    'paidOrders', count(*) filter (where paid)::int,
    'aov', case
      when count(*) filter (where paid) > 0
        then round((sum(case when paid then total else 0 end)::numeric / (count(*) filter (where paid)))::numeric)::int
      else 0
    end,
    'discountGiven', coalesce(sum(discount), 0)::bigint
  ) as data
  from orders_window
)
select jsonb_build_object(
  'days', (select days from bounds),
  'series', coalesce((select jsonb_agg(jsonb_build_object('date', to_char(day, 'YYYY-MM-DD'), 'revenue', revenue, 'orders', orders) order by day) from series), '[]'::jsonb),
  'totals', (select data from totals),
  'statusBreakdown', (select data from status_breakdown),
  'payment', (select data from payment_breakdown),
  'topProducts', (select data from top_products)
);
$$;

create or replace function public.get_admin_dashboard_stats()
returns jsonb
language sql
stable
set search_path = public
as $$
with recent_orders as (
  select id, total, status, customer, created_at
  from public.orders
  order by created_at desc
  limit 6
),
totals as (
  select jsonb_build_object(
    'orders', count(*)::int,
    'revenue', coalesce(sum(case when paid and status <> 'cancelled' then total else 0 end), 0)::bigint,
    'pending', count(*) filter (where paid = false and status not in ('cancelled', 'expired'))::int,
    'leads', (select count(*)::int from public.leads),
    'users', (select count(*)::int from public.users),
    'products', (select count(*)::int from public.products),
    'recent', coalesce(
      (select jsonb_agg(jsonb_build_object(
        'id', ro.id,
        'total', ro.total,
        'status', ro.status,
        'name', coalesce(ro.customer->>'name', '')
      ) order by ro.created_at desc) from recent_orders ro),
      '[]'::jsonb
    )
  ) as data
  from public.orders
)
select data from totals;
$$;

create or replace function public.get_admin_order_summaries(
  p_limit integer default 200,
  p_offset integer default 0
)
returns table (
  id text,
  total bigint,
  payment_method text,
  status text,
  paid boolean,
  payment_claimed boolean,
  tracking text,
  created_at bigint,
  user_id text,
  channel text,
  line_user_id text,
  customer_name text,
  customer_phone text,
  item_count integer,
  item_summary text
)
language sql
stable
set search_path = public
as $$
  with limited_orders as (
    select *
    from public.orders
    order by created_at desc
    limit greatest(1, least(coalesce(p_limit, 200), 500))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select
    o.id,
    o.total::bigint,
    coalesce(o.payment_method, '') as payment_method,
    coalesce(o.status, '') as status,
    coalesce(o.paid, false) as paid,
    coalesce(o.payment_claimed, false) as payment_claimed,
    coalesce(o.tracking, '') as tracking,
    coalesce(o.created_at, 0)::bigint as created_at,
    coalesce(o.user_id, '') as user_id,
    coalesce(nullif(trim(o.channel), ''), 'web') as channel,
    coalesce(o.line_user_id, '') as line_user_id,
    coalesce(o.customer->>'name', '') as customer_name,
    coalesce(o.customer->>'phone', '') as customer_phone,
    coalesce((
      select sum(
        case
          when coalesce(item->>'qty', '') ~ '^\d+$' then greatest((item->>'qty')::int, 1)
          else 1
        end
      )::int
      from jsonb_array_elements(
        case
          when jsonb_typeof(o.items) = 'array' then o.items
          else '[]'::jsonb
        end
      ) as item
    ), 0) as item_count,
    coalesce((
      select string_agg(
        trim(
          coalesce(item->>'name', 'สินค้า') ||
          '×' ||
          (
            case
              when coalesce(item->>'qty', '') ~ '^\d+$' then greatest((item->>'qty')::int, 1)::text
              else '1'
            end
          )
        ),
        ', '
        order by ord
      )
      from jsonb_array_elements(
        case
          when jsonb_typeof(o.items) = 'array' then o.items
          else '[]'::jsonb
        end
      ) with ordinality as entry(item, ord)
    ), '') as item_summary
  from limited_orders o
  order by o.created_at desc;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public' and tablename = 'products' and policyname = 'public_read_active_products'
  ) then
    create policy public_read_active_products
    on public.products
    for select
    using (active = true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public' and tablename = 'articles' and policyname = 'public_read_published_articles'
  ) then
    create policy public_read_published_articles
    on public.articles
    for select
    using (published = true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public' and tablename = 'reviews' and policyname = 'public_read_reviews'
  ) then
    create policy public_read_reviews
    on public.reviews
    for select
    using (true);
  end if;
end $$;

revoke all on function public.reserve_order_resources(jsonb, text) from public, anon, authenticated;
grant execute on function public.reserve_order_resources(jsonb, text) to service_role;

revoke all on function public.release_order_resources(jsonb, text) from public, anon, authenticated;
grant execute on function public.release_order_resources(jsonb, text) to service_role;

revoke all on function public.increment_coupon_use(text) from public, anon, authenticated;
grant execute on function public.increment_coupon_use(text) to service_role;

revoke all on function public.get_admin_order_analytics(integer) from public, anon, authenticated;
grant execute on function public.get_admin_order_analytics(integer) to service_role;

revoke all on function public.get_admin_dashboard_stats() from public, anon, authenticated;
grant execute on function public.get_admin_dashboard_stats() to service_role;

revoke all on function public.get_admin_order_summaries(integer, integer) from public, anon, authenticated;
grant execute on function public.get_admin_order_summaries(integer, integer) to service_role;

grant execute on function public.get_review_stats(text) to anon, authenticated, service_role;

comment on table public.orders is 'Migrated from local SQLite store';
comment on table public.settings is 'CMS/site settings key-value store';
comment on table public.stores is 'Tenant/store registry for wildcard subdomain storefronts';
comment on table public.store_domains is 'Maps public hosts/subdomains to stores';
comment on table public.store_settings is 'Per-store override settings layered on top of global settings';
comment on table public.user_store_roles is 'Membership and role mapping for users across stores';
comment on table public.store_databases is 'Logical per-store database registry. Data remains in shared Supabase tables and is isolated by store_id.';
comment on index public.idx_coupons_store_code_unique is 'Allows coupon codes to repeat across stores while remaining unique inside each store.';

create table if not exists public.chat_session_meta (
  session_id text primary key,
  meta jsonb not null default '{}'::jsonb,
  updated_at bigint not null default 0
);
alter table public.chat_session_meta enable row level security;

create table if not exists public.line_webhook_events (
  event_key text primary key,
  at bigint not null default 0
);
alter table public.line_webhook_events enable row level security;

create table if not exists public.line_webhook_audits (
  id text primary key,
  at bigint not null default 0,
  event_key text not null default '',
  event_type text not null default '',
  source_key text not null default '',
  message_type text not null default '',
  text_preview text not null default '',
  result text not null default '',
  duration_ms bigint not null default 0,
  error text not null default '',
  note text not null default ''
);
create index if not exists idx_line_webhook_audits_at on public.line_webhook_audits (at desc);
alter table public.line_webhook_audits enable row level security;
alter table public.community_posts enable row level security;
alter table public.community_comments enable row level security;
alter table public.community_reactions enable row level security;
alter table public.community_saves enable row level security;
alter table public.community_stories enable row level security;
