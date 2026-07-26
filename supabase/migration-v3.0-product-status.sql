-- BlueWell Inventory v3.0
-- Adds an explicit active/inactive status for products.
-- Safe to run more than once.

alter table public.products
  add column if not exists is_active boolean;

update public.products
set is_active = true
where is_active is null;

alter table public.products
  alter column is_active set default true,
  alter column is_active set not null;

create index if not exists products_active_idx
  on public.products(is_active);
