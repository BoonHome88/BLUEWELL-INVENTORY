-- BlueWell Inventory v3.2 - Case to piece conversion
-- Stores stock in pieces while allowing each product to define pieces per case.
-- Safe to run more than once.

alter table public.products
  add column if not exists units_per_case integer;

update public.products
set units_per_case = 1
where units_per_case is null or units_per_case < 1;

alter table public.products
  alter column units_per_case set default 1,
  alter column units_per_case set not null;

alter table public.products
  drop constraint if exists products_units_per_case_check;

alter table public.products
  add constraint products_units_per_case_check
  check (units_per_case > 0);
