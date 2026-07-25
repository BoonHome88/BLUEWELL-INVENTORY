-- Run once in Supabase SQL Editor before using inventory valuation.
alter table public.products
  add column if not exists unit_cost numeric(14,2) not null default 0
  check (unit_cost >= 0);
