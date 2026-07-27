-- BlueWell Inventory v3.1 - Prepack inventory
-- Move goods from the central warehouse into a separate prepack balance.
-- Run this file in Supabase SQL Editor.

create table if not exists public.prepack_inventory (
  product_id uuid primary key references public.products(id) on delete restrict,
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.prepack_document_counters (
  counter_date date not null,
  transaction_type text not null check (transaction_type in ('pack', 'ship', 'return')),
  last_number integer not null default 0,
  primary key (counter_date, transaction_type)
);

create table if not exists public.prepack_transactions (
  id uuid primary key default gen_random_uuid(),
  document_no text not null unique,
  product_id uuid not null references public.products(id) on delete restrict,
  transaction_type text not null check (transaction_type in ('pack', 'ship', 'return')),
  quantity integer not null check (quantity > 0),
  prepack_before integer not null check (prepack_before >= 0),
  prepack_after integer not null check (prepack_after >= 0),
  stock_before integer not null check (stock_before >= 0),
  stock_after integer not null check (stock_after >= 0),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  actor_name text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists prepack_transactions_product_idx
  on public.prepack_transactions(product_id);
create index if not exists prepack_transactions_created_idx
  on public.prepack_transactions(created_at desc);
create index if not exists prepack_transactions_type_idx
  on public.prepack_transactions(transaction_type);

create or replace function public.process_prepack_transaction(
  p_product_id uuid,
  p_transaction_type text,
  p_quantity integer,
  p_note text default ''
)
returns public.prepack_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_actor_name text;
  v_product public.products%rowtype;
  v_prepack_before integer;
  v_prepack_after integer;
  v_stock_after integer;
  v_counter integer;
  v_prefix text;
  v_document_no text;
  v_result public.prepack_transactions%rowtype;
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

  if p_transaction_type not in ('pack', 'ship', 'return') then
    raise exception 'Invalid prepack transaction type';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be greater than zero';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
  for update;

  if not found then
    raise exception 'Product not found';
  end if;

  insert into public.prepack_inventory(product_id, quantity)
  values (p_product_id, 0)
  on conflict (product_id) do nothing;

  select quantity into v_prepack_before
  from public.prepack_inventory
  where product_id = p_product_id
  for update;

  if p_transaction_type = 'pack' then
    if not v_product.is_active then
      raise exception 'Product is inactive';
    end if;
    if v_product.quantity < p_quantity then
      raise exception 'Insufficient central stock. Available: %', v_product.quantity;
    end if;
    v_stock_after := v_product.quantity - p_quantity;
    v_prepack_after := v_prepack_before + p_quantity;
    v_prefix := 'PP';
  elsif p_transaction_type = 'ship' then
    if v_prepack_before < p_quantity then
      raise exception 'Insufficient prepack stock. Available: %', v_prepack_before;
    end if;
    v_stock_after := v_product.quantity;
    v_prepack_after := v_prepack_before - p_quantity;
    v_prefix := 'PS';
  else
    if v_prepack_before < p_quantity then
      raise exception 'Insufficient prepack stock. Available: %', v_prepack_before;
    end if;
    v_stock_after := v_product.quantity + p_quantity;
    v_prepack_after := v_prepack_before - p_quantity;
    v_prefix := 'PR';
  end if;

  insert into public.prepack_document_counters(counter_date, transaction_type, last_number)
  values (current_date, p_transaction_type, 1)
  on conflict (counter_date, transaction_type)
  do update set last_number = public.prepack_document_counters.last_number + 1
  returning last_number into v_counter;

  v_document_no := v_prefix || '-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(v_counter::text, 4, '0');

  update public.products
  set quantity = v_stock_after, updated_at = now()
  where id = p_product_id;

  update public.prepack_inventory
  set quantity = v_prepack_after, updated_at = now()
  where product_id = p_product_id;

  insert into public.prepack_transactions (
    document_no, product_id, transaction_type, quantity,
    prepack_before, prepack_after, stock_before, stock_after,
    actor_id, actor_name, note
  ) values (
    v_document_no, p_product_id, p_transaction_type, p_quantity,
    v_prepack_before, v_prepack_after, v_product.quantity, v_stock_after,
    v_user_id, v_actor_name, coalesce(p_note, '')
  )
  returning * into v_result;

  return v_result;
end;
$$;

alter table public.prepack_inventory enable row level security;
alter table public.prepack_document_counters enable row level security;
alter table public.prepack_transactions enable row level security;

drop policy if exists "prepack_inventory_active_users_read" on public.prepack_inventory;
create policy "prepack_inventory_active_users_read" on public.prepack_inventory
for select to authenticated
using ((select public.is_active_user()));

drop policy if exists "prepack_transactions_active_users_read" on public.prepack_transactions;
create policy "prepack_transactions_active_users_read" on public.prepack_transactions
for select to authenticated
using ((select public.is_active_user()));

revoke all on public.prepack_inventory, public.prepack_document_counters,
  public.prepack_transactions from anon;
revoke insert, update, delete on public.prepack_inventory,
  public.prepack_document_counters, public.prepack_transactions from authenticated;

grant select on public.prepack_inventory, public.prepack_transactions to authenticated;

revoke all on function public.process_prepack_transaction(uuid, text, integer, text) from public;
grant execute on function public.process_prepack_transaction(uuid, text, integer, text) to authenticated;
