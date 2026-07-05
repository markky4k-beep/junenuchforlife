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

alter table public.community_posts add column if not exists store_id text not null default 'store_main';
alter table public.community_posts add column if not exists author_avatar text not null default '';
alter table public.community_comments add column if not exists store_id text not null default 'store_main';
alter table public.community_reactions add column if not exists store_id text not null default 'store_main';
alter table public.community_saves add column if not exists store_id text not null default 'store_main';
alter table public.community_stories add column if not exists store_id text not null default 'store_main';

update public.community_posts
set store_id = 'store_main'
where coalesce(store_id, '') = '';

update public.community_stories
set store_id = 'store_main'
where coalesce(store_id, '') = '';

update public.community_comments c
set store_id = coalesce(p.store_id, 'store_main')
from public.community_posts p
where p.id = c.post_id
  and coalesce(c.store_id, '') = '';

update public.community_reactions r
set store_id = coalesce(p.store_id, 'store_main')
from public.community_posts p
where p.id = r.post_id
  and coalesce(r.store_id, '') = '';

update public.community_saves s
set store_id = coalesce(p.store_id, 'store_main')
from public.community_posts p
where p.id = s.post_id
  and coalesce(s.store_id, '') = '';

create index if not exists idx_community_posts_store_status_created
  on public.community_posts (store_id, status, pinned desc, created_at desc);

create index if not exists idx_community_comments_store_post_created
  on public.community_comments (store_id, post_id, status, created_at);

create index if not exists idx_community_reactions_store_post
  on public.community_reactions (store_id, post_id, type);

create index if not exists idx_community_saves_store_post
  on public.community_saves (store_id, post_id);

create index if not exists idx_community_stories_store_expiry
  on public.community_stories (store_id, status, expires_at desc, created_at desc);

alter table public.community_posts enable row level security;
alter table public.community_comments enable row level security;
alter table public.community_reactions enable row level security;
alter table public.community_saves enable row level security;
alter table public.community_stories enable row level security;
