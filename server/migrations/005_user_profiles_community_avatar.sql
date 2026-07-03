alter table if exists users
  add column if not exists username text default '';

alter table if exists users
  add column if not exists avatar text default '';

alter table if exists community_posts
  add column if not exists author_avatar text default '';
