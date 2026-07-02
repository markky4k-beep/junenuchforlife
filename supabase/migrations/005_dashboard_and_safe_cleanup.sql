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

update public.orders
set channel = 'web'
where coalesce(trim(channel), '') = '';

update public.orders
set line_user_id = ''
where line_user_id is null;

update public.reviews
set name = 'ลูกค้า'
where coalesce(trim(name), '') = '';

update public.reviews
set user_id = 'guest:' || id::text
where coalesce(trim(user_id), '') = '';

update public.products
set tag = ''
where trim(coalesce(tag, '')) in ('เกษตร', 'สินค้าเดี่ยว', 'ชุดแพ็ก', 'ชุดเซต', 'โปรโมชั่น', 'สุขภาพ', 'ความงาม');

update public.products
set model = ''
where coalesce(trim(model), '') <> ''
  and model !~* '\.(glb|gltf)(\?.*)?$';

update public.products
set name = 'แพ็กนุชฟอร์ไลฟ์ 1 + 2 + 8 + 9'
where id = 'nfl-pack-1-2-8-9'
  and coalesce(trim(name), '') = '';

revoke all on function public.get_admin_dashboard_stats() from public, anon, authenticated;
grant execute on function public.get_admin_dashboard_stats() to service_role;
