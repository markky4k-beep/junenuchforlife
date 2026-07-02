create extension if not exists pgcrypto;

alter table public.orders
  add column if not exists access_token text not null default '';

alter table public.orders
  add column if not exists resources_reserved boolean not null default false;

update public.orders
   set access_token = encode(gen_random_bytes(24), 'hex')
 where coalesce(access_token, '') = '';

update public.orders
   set resources_reserved = case when status = 'cancelled' then false else true end
 where resources_reserved = false;

create unique index if not exists idx_orders_access_token on public.orders (access_token);

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
