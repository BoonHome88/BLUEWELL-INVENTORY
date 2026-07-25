-- BlueWell Inventory v1.3
-- Safe to run more than once from Supabase Dashboard SQL Editor.

alter table public.products
  add column if not exists unit_cost numeric not null default 0;

comment on column public.products.unit_cost is
  'Current unit cost used for inventory valuation and reporting';
