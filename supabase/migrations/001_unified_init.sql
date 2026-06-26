-- ============================================================================
-- Unified schema for "JunenuchforlifeMain" (gtqpefjhaxheyllygbrn)
-- Single source of truth for: Website (Node/Express) + LINE OA bot (Python).
--
-- Design rules:
--   * Website storefront tables keep their original shape (bigint epoch ts)
--     so existing server/db-supabase.js keeps working unchanged.
--   * LINE bot support tables keep their original shape (timestamptz)
--     so lineoa_bot/supabase_store.py keeps working unchanged.
--   * The ONLY merged table is `orders` (website e-commerce shape is canonical)
--     with channel/line_user_id added so both sides share one order ledger.
-- ============================================================================

create extension if not exists pgcrypto;

-- ─────────────────────────── Identity & CMS (website) ──────────────────────
create table if not exists public.users (
  id text primary key,
  email text not null unique,
  name text not null default '',
  salt text not null,
  hash text not null,
  role text not null default 'user',
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
comment on table public.settings is 'CMS/site settings key-value store';

create table if not exists public.articles (
  id text primary key,
  title text not null,
  cover text not null default '',
  excerpt text not null default '',
  body text not null default '',
  published boolean not null default true,
  created_at bigint not null
);

create table if not exists public.coupons (
  code text primary key,
  type text not null,
  value integer not null,
  min_total integer not null default 0,
  max_uses integer not null default 0,
  used integer not null default 0,
  active boolean not null default true,
  expires_at bigint not null default 0,
  created_at bigint not null
);

-- ─────────────────────────── Catalog ───────────────────────────────────────
-- Website storefront products (canonical product master for the web shop)
create table if not exists public.products (
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
  created_at bigint not null
);

-- LINE OA catalog (merchandising groups shown inside LINE flex menus)
create table if not exists public.product_collections (
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
  -- optional link to the website storefront product (so web & LINE can share a SKU)
  web_product_id text references public.products(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (collection_key, title)
);
create index if not exists idx_product_catalog_collection_active
  on public.product_catalog(collection_key, is_active, sort_order, created_at);

-- LINE admin draft buffers (in-flight product/collection edits from LINE admin)
create table if not exists public.admin_product_drafts (
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

-- ─────────────────────────── Commerce (unified ledger) ─────────────────────
-- Canonical order ledger. Website e-commerce shape is the source of truth.
-- channel marks where the order originated; line_user_id links LINE customers.
create table if not exists public.orders (
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
  channel text not null default 'web',         -- 'web' | 'line'
  line_user_id text not null default '',        -- set for orders that came from LINE
  created_at bigint not null,
  updated_at bigint not null
);
create index if not exists idx_orders_created_at on public.orders (created_at desc);
create index if not exists idx_orders_user_id on public.orders (user_id);
create index if not exists idx_orders_channel on public.orders (channel, created_at desc);
create index if not exists idx_orders_line_user on public.orders (line_user_id);

create table if not exists public.reviews (
  id bigint generated by default as identity primary key,
  product_id text not null,
  user_id text not null,
  name text not null default '',
  rating integer not null,
  comment text not null default '',
  created_at bigint not null
);
create index if not exists idx_reviews_product_id on public.reviews (product_id, created_at desc);

create table if not exists public.leads (
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
create index if not exists idx_leads_created_at on public.leads (created_at desc);

-- Payment slips / verification log (used by LINE bot slip flow; references unified orders)
create table if not exists public.payment_logs (
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
create index if not exists idx_payment_logs_status on public.payment_logs (status);
create index if not exists idx_payment_logs_updated_at on public.payment_logs (updated_at desc);

-- LINE OA members (CRM captured from LINE)
create table if not exists public.members (
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
create index if not exists idx_members_line_id on public.members (line_id);

create table if not exists public.admin_access (
  user_id text primary key,
  display_name text not null default '',
  granted_by text not null default '',
  key_name text not null default '',
  unlocked_at timestamptz not null default timezone('utc', now())
);
create index if not exists idx_admin_access_unlocked_at on public.admin_access (unlocked_at desc);

-- ─────────────────────────── Chat / Bridge ─────────────────────────────────
-- Website Socket.IO chat history
create table if not exists public.messages (
  id bigint generated by default as identity primary key,
  session_id text not null,
  sender text not null,
  text text not null,
  at bigint not null
);
create index if not exists idx_messages_session_id on public.messages (session_id);

-- LINE bot per-user conversation state machine
create table if not exists public.user_sessions (
  user_id text primary key,
  state text,
  product text not null default '',
  address text not null default '',
  payment text not null default '',
  order_id text not null default '',
  updated_at timestamptz not null default timezone('utc', now())
);
create index if not exists idx_user_sessions_updated_at on public.user_sessions (updated_at desc);

-- Website <-> LINE OA live chat bridge
create table if not exists public.web_bridge_sessions (
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
create index if not exists idx_web_bridge_sessions_line_user_id on public.web_bridge_sessions(line_user_id);
create index if not exists idx_web_bridge_sessions_website_session_id on public.web_bridge_sessions(website_session_id);
create index if not exists idx_web_bridge_sessions_status_updated on public.web_bridge_sessions(status, updated_at desc);

create table if not exists public.web_bridge_messages (
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
create index if not exists idx_web_bridge_messages_bridge_created on public.web_bridge_messages(bridge_id, created_at asc);
create index if not exists idx_web_bridge_messages_delivery on public.web_bridge_messages(delivery_status, created_at desc);
