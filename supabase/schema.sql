-- Stock Management System Online - Supabase Schema v1
-- Run this entire file once in Supabase Dashboard > SQL Editor.
-- Designed for authenticated multi-user access with RLS enabled.

begin;

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Utility functions
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- User profiles
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'employee' check (role in ('admin', 'employee')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(new.email, ''), '@', 1)),
    'employee'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
      and p.is_active = true
  );
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active = true
  );
$$;

-- Lets only the very first registered user claim the initial admin role.
create or replace function public.claim_first_admin()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'You must be signed in';
  end if;

  if exists (select 1 from public.profiles where role = 'admin') then
    return false;
  end if;

  update public.profiles
  set role = 'admin', is_active = true, updated_at = now()
  where id = current_user_id;

  return found;
end;
$$;

-- -----------------------------------------------------------------------------
-- Core stock tables
-- -----------------------------------------------------------------------------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_name_not_blank check (length(trim(name)) > 0)
);
create unique index if not exists categories_name_unique_ci
  on public.categories (lower(trim(name)));

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  name text not null,
  category_id uuid references public.categories(id) on delete set null,
  quantity integer not null default 0 check (quantity >= 0),
  unit text not null default 'ชิ้น',
  units_per_case integer not null default 1 check (units_per_case > 0),
  min_stock integer not null default 0 check (min_stock >= 0),
  image_path text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_sku_not_blank check (length(trim(sku)) > 0),
  constraint products_name_not_blank check (length(trim(name)) > 0)
);
create unique index if not exists products_sku_unique_ci
  on public.products (lower(trim(sku)));
create index if not exists products_category_id_idx on public.products(category_id);
create index if not exists products_active_idx on public.products(is_active);

create table if not exists public.document_counters (
  counter_date date not null,
  transaction_type text not null check (transaction_type in ('issue', 'restock', 'returned')),
  last_number integer not null default 0,
  primary key (counter_date, transaction_type)
);

create table if not exists public.stock_transactions (
  id uuid primary key default gen_random_uuid(),
  document_no text not null unique,
  product_id uuid not null references public.products(id) on delete restrict,
  transaction_type text not null check (transaction_type in ('issue', 'restock', 'returned')),
  quantity integer not null check (quantity > 0),
  balance_before integer not null check (balance_before >= 0),
  balance_after integer not null check (balance_after >= 0),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  actor_name text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists stock_transactions_product_id_idx on public.stock_transactions(product_id);
create index if not exists stock_transactions_created_at_idx on public.stock_transactions(created_at desc);
create index if not exists stock_transactions_actor_id_idx on public.stock_transactions(actor_id);
create index if not exists stock_transactions_type_idx on public.stock_transactions(transaction_type);

create table if not exists public.company_settings (
  id boolean primary key default true check (id = true),
  company_name text not null default 'CYN Studio',
  system_title text not null default 'Stock Management System',
  subtitle text not null default 'ระบบจัดการสต็อกสินค้า',
  address text not null default '',
  phone text not null default '',
  email text not null default '',
  report_footer text not null default '',
  logo_path text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.company_settings (id) values (true)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Atomic stock movement RPC
-- Locks the product row, validates stock, updates quantity, and records history.
-- Direct inserts into stock_transactions are intentionally not allowed.
-- -----------------------------------------------------------------------------
create or replace function public.process_stock_transaction(
  p_product_id uuid,
  p_transaction_type text,
  p_quantity integer,
  p_note text default ''
)
returns public.stock_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_actor_name text;
  v_product public.products%rowtype;
  v_balance_after integer;
  v_counter integer;
  v_prefix text;
  v_document_no text;
  v_result public.stock_transactions%rowtype;
begin
  if v_user_id is null then
    raise exception 'You must be signed in';
  end if;

  select full_name into v_actor_name
  from public.profiles
  where id = v_user_id and is_active = true;

  if v_actor_name is null then
    raise exception 'Your account is inactive or profile is missing';
  end if;

  if p_transaction_type not in ('issue', 'restock', 'returned') then
    raise exception 'Invalid transaction type';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be greater than zero';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id and is_active = true
  for update;

  if not found then
    raise exception 'Product not found or inactive';
  end if;

  if p_transaction_type = 'issue' then
    if v_product.quantity < p_quantity then
      raise exception 'Insufficient stock. Available: %', v_product.quantity;
    end if;
    v_balance_after := v_product.quantity - p_quantity;
    v_prefix := 'BK';
  elsif p_transaction_type = 'restock' then
    v_balance_after := v_product.quantity + p_quantity;
    v_prefix := 'RC';
  else
    v_balance_after := v_product.quantity + p_quantity;
    v_prefix := 'RT';
  end if;

  insert into public.document_counters(counter_date, transaction_type, last_number)
  values (current_date, p_transaction_type, 1)
  on conflict (counter_date, transaction_type)
  do update set last_number = public.document_counters.last_number + 1
  returning last_number into v_counter;

  v_document_no := v_prefix || '-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(v_counter::text, 4, '0');

  update public.products
  set quantity = v_balance_after, updated_at = now()
  where id = p_product_id;

  insert into public.stock_transactions (
    document_no, product_id, transaction_type, quantity,
    balance_before, balance_after, actor_id, actor_name, note
  ) values (
    v_document_no, p_product_id, p_transaction_type, p_quantity,
    v_product.quantity, v_balance_after, v_user_id, v_actor_name, coalesce(p_note, '')
  )
  returning * into v_result;

  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- Updated-at triggers
-- -----------------------------------------------------------------------------
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at before update on public.categories
for each row execute function public.set_updated_at();

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at before update on public.products
for each row execute function public.set_updated_at();

drop trigger if exists company_settings_set_updated_at on public.company_settings;
create trigger company_settings_set_updated_at before update on public.company_settings
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.document_counters enable row level security;
alter table public.stock_transactions enable row level security;
alter table public.company_settings enable row level security;

-- Profiles
create policy "profiles_read_self_or_admin" on public.profiles
for select to authenticated
using (id = (select auth.uid()) or (select public.is_admin()));

create policy "profiles_admin_update" on public.profiles
for update to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

-- Categories
create policy "categories_active_users_read" on public.categories
for select to authenticated
using ((select public.is_active_user()));

create policy "categories_admin_insert" on public.categories
for insert to authenticated
with check ((select public.is_admin()) and created_by = (select auth.uid()));

create policy "categories_admin_update" on public.categories
for update to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy "categories_admin_delete" on public.categories
for delete to authenticated
using ((select public.is_admin()));

-- Products
create policy "products_active_users_read" on public.products
for select to authenticated
using ((select public.is_active_user()));

create policy "products_admin_insert" on public.products
for insert to authenticated
with check ((select public.is_admin()) and created_by = (select auth.uid()));

create policy "products_admin_update" on public.products
for update to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy "products_admin_delete" on public.products
for delete to authenticated
using ((select public.is_admin()));

-- Transactions are immutable audit records and can only be created by the RPC.
create policy "transactions_active_users_read" on public.stock_transactions
for select to authenticated
using ((select public.is_active_user()));

-- Company settings
create policy "company_settings_active_users_read" on public.company_settings
for select to authenticated
using ((select public.is_active_user()));

create policy "company_settings_admin_update" on public.company_settings
for update to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

-- No client policies on document_counters. It is accessible only inside the RPC.

-- -----------------------------------------------------------------------------
-- Privileges for Data API
-- -----------------------------------------------------------------------------
revoke all on public.profiles, public.categories, public.products,
  public.document_counters, public.stock_transactions, public.company_settings
from anon;

grant select on public.profiles, public.categories, public.products,
  public.stock_transactions, public.company_settings
to authenticated;

grant insert, update, delete on public.categories, public.products to authenticated;
grant update on public.profiles, public.company_settings to authenticated;

revoke all on function public.process_stock_transaction(uuid, text, integer, text) from public;
grant execute on function public.process_stock_transaction(uuid, text, integer, text) to authenticated;

-- Admin correction RPC. Deletes an incorrect transaction, reverses its stock
-- effect, and shifts all later balance snapshots for the same product.
create or replace function public.delete_incorrect_stock_transaction(
  p_transaction_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_transaction public.stock_transactions%rowtype;
  v_product public.products%rowtype;
  v_delta integer;
  v_min_balance integer;
  v_new_quantity integer;
begin
  if v_user_id is null then raise exception 'You must be signed in'; end if;
  if not public.is_admin() then raise exception 'Only administrators can delete incorrect transactions'; end if;

  select * into v_transaction from public.stock_transactions
  where id = p_transaction_id for update;
  if not found then raise exception 'Transaction not found'; end if;

  select * into v_product from public.products
  where id = v_transaction.product_id for update;
  if not found then raise exception 'Product not found'; end if;

  v_delta := case when v_transaction.transaction_type = 'issue'
    then v_transaction.quantity else -v_transaction.quantity end;
  v_new_quantity := v_product.quantity + v_delta;
  if v_new_quantity < 0 then
    raise exception 'Cannot delete this transaction because current stock would become negative (%)', v_new_quantity;
  end if;

  select min(least(balance_before + v_delta, balance_after + v_delta))
  into v_min_balance from public.stock_transactions
  where product_id = v_transaction.product_id
    and created_at > v_transaction.created_at;
  if v_min_balance is not null and v_min_balance < 0 then
    raise exception 'Cannot delete this transaction because a later balance would become negative (%)', v_min_balance;
  end if;

  update public.stock_transactions
  set balance_before = balance_before + v_delta,
      balance_after = balance_after + v_delta
  where product_id = v_transaction.product_id
    and created_at > v_transaction.created_at;

  update public.products set quantity = v_new_quantity, updated_at = now()
  where id = v_transaction.product_id;
  delete from public.stock_transactions where id = v_transaction.id;

  return jsonb_build_object(
    'deleted_document_no', v_transaction.document_no,
    'product_id', v_transaction.product_id,
    'product_name', v_product.name,
    'quantity_delta', v_delta,
    'new_quantity', v_new_quantity
  );
end;
$$;

revoke all on function public.delete_incorrect_stock_transaction(uuid) from public;
grant execute on function public.delete_incorrect_stock_transaction(uuid) to authenticated;

revoke all on function public.claim_first_admin() from public;
grant execute on function public.claim_first_admin() to authenticated;

-- -----------------------------------------------------------------------------
-- Storage bucket for product images and company logo.
-- Public read URLs; only admins can upload/update/delete objects.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'stock-assets',
  'stock-assets',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "stock_assets_admin_insert" on storage.objects
for insert to authenticated
with check (bucket_id = 'stock-assets' and (select public.is_admin()));

create policy "stock_assets_admin_update" on storage.objects
for update to authenticated
using (bucket_id = 'stock-assets' and (select public.is_admin()))
with check (bucket_id = 'stock-assets' and (select public.is_admin()));

create policy "stock_assets_admin_delete" on storage.objects
for delete to authenticated
using (bucket_id = 'stock-assets' and (select public.is_admin()));

-- -----------------------------------------------------------------------------
-- Realtime publication (Postgres Changes)
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'products'
  ) then
    alter publication supabase_realtime add table public.products;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stock_transactions'
  ) then
    alter publication supabase_realtime add table public.stock_transactions;
  end if;
end $$;

commit;

-- v1.2: cost per unit for inventory valuation
alter table public.products
  add column if not exists unit_cost numeric(14,2) not null default 0
  check (unit_cost >= 0);
