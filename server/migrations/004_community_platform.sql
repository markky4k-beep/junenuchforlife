create table if not exists community_posts (
  store_id text not null default 'store_main',
  id text primary key,
  user_id text default '',
  author_name text not null default 'สมาชิก',
  author_role text not null default 'member',
  caption text not null default '',
  media jsonb not null default '[]'::jsonb,
  hashtags jsonb not null default '[]'::jsonb,
  article_id text default '',
  product_ids jsonb not null default '[]'::jsonb,
  status text not null default 'pending',
  pinned boolean not null default false,
  created_at bigint not null,
  updated_at bigint not null
);

create index if not exists idx_community_posts_store_status_created
  on community_posts (store_id, status, pinned desc, created_at desc);

create table if not exists community_comments (
  id text primary key,
  post_id text not null references community_posts(id) on delete cascade,
  user_id text default '',
  author_name text not null default 'สมาชิก',
  text text not null default '',
  status text not null default 'approved',
  created_at bigint not null
);

create index if not exists idx_community_comments_post_created
  on community_comments (post_id, status, created_at);

create table if not exists community_reactions (
  post_id text not null references community_posts(id) on delete cascade,
  user_id text not null,
  type text not null default 'like',
  created_at bigint not null,
  primary key (post_id, user_id, type)
);

create table if not exists community_saves (
  post_id text not null references community_posts(id) on delete cascade,
  user_id text not null,
  created_at bigint not null,
  primary key (post_id, user_id)
);

create table if not exists community_stories (
  store_id text not null default 'store_main',
  id text primary key,
  post_id text default '',
  author_name text not null default 'Community',
  title text default '',
  media text not null default '',
  caption text default '',
  status text not null default 'approved',
  created_at bigint not null,
  expires_at bigint not null
);

create index if not exists idx_community_stories_store_expiry
  on community_stories (store_id, status, expires_at desc, created_at desc);
