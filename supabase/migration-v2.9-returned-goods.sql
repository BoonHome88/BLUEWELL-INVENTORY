-- BlueWell Inventory v2.9
-- Enables the returned-goods stock transaction type.
-- Safe to run more than once.

alter table public.document_counters
  drop constraint if exists document_counters_transaction_type_check;
alter table public.document_counters
  add constraint document_counters_transaction_type_check
  check (transaction_type in ('issue', 'restock', 'returned'));

alter table public.stock_transactions
  drop constraint if exists stock_transactions_transaction_type_check;
alter table public.stock_transactions
  add constraint stock_transactions_transaction_type_check
  check (transaction_type in ('issue', 'restock', 'returned'));

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
