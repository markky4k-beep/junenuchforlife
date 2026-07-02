create index if not exists idx_orders_expirable_pending
on public.orders (created_at asc)
where paid = false and payment_claimed = false and resources_reserved = true and status = 'awaiting_payment';

create index if not exists idx_orders_user_created_at
on public.orders (user_id, created_at desc);

create index if not exists idx_messages_session_at
on public.messages (session_id, at asc);

create unique index if not exists idx_reviews_product_user
on public.reviews (product_id, user_id);

create index if not exists idx_users_role_created_at
on public.users (role, created_at desc);

create index if not exists idx_auth_tokens_expires_at
on public.auth_tokens (expires_at asc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reviews_rating_range_check'
  ) then
    alter table public.reviews
      add constraint reviews_rating_range_check
      check (rating between 1 and 5);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_non_negative_check'
  ) then
    alter table public.products
      add constraint products_non_negative_check
      check (price >= 0 and stock >= 0 and sort >= 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'coupons_non_negative_check'
  ) then
    alter table public.coupons
      add constraint coupons_non_negative_check
      check (value >= 0 and min_total >= 0 and max_uses >= 0 and used >= 0);
  end if;
end $$;

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
