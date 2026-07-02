create or replace function public.get_admin_order_summaries(p_limit integer default 200)
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

revoke all on function public.get_admin_order_summaries(integer) from public, anon, authenticated;
grant execute on function public.get_admin_order_summaries(integer) to service_role;
