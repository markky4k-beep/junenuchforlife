do $$
declare
  pk_name text;
begin
  select conname
    into pk_name
  from pg_constraint
  where conrelid = 'public.coupons'::regclass
    and contype = 'p'
  limit 1;

  if pk_name is not null then
    execute format('alter table public.coupons drop constraint %I', pk_name);
  end if;
end $$;

create unique index if not exists idx_coupons_store_code_unique
  on public.coupons(store_id, code);

comment on index public.idx_coupons_store_code_unique is
  'Allows coupon codes to repeat across stores while remaining unique inside each store.';
