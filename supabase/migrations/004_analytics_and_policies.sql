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

grant execute on function public.get_review_stats(text) to anon, authenticated, service_role;
