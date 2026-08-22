-- BlueWell Inventory v3.11
-- Optional central-stock deduction for prepack + partial-case metadata.
-- Run once in Supabase SQL Editor.

alter table public.products
  add column if not exists partial_case_count integer not null default 0,
  add column if not exists partial_case_pieces integer not null default 0;

alter table public.products
  drop constraint if exists products_partial_case_count_check,
  drop constraint if exists products_partial_case_pieces_check;

alter table public.products
  add constraint products_partial_case_count_check check (partial_case_count >= 0),
  add constraint products_partial_case_pieces_check check (partial_case_pieces >= 0);

alter table public.prepack_inventory
  add column if not exists external_quantity integer not null default 0;

alter table public.prepack_inventory
  drop constraint if exists prepack_inventory_external_quantity_check;

alter table public.prepack_inventory
  add constraint prepack_inventory_external_quantity_check check (
    external_quantity >= 0 and external_quantity <= quantity
  );

alter table public.prepack_transactions
  add column if not exists central_stock_affected boolean not null default true;

drop function if exists public.process_prepack_transaction(uuid, text, integer, text);

create function public.process_prepack_transaction(
  p_product_id uuid,
  p_transaction_type text,
  p_quantity integer,
  p_note text default '',
  p_deduct_central boolean default true
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
  v_external_before integer;
  v_prepack_after integer;
  v_external_after integer;
  v_stock_after integer;
  v_central_prepack integer;
  v_external_used integer := 0;
  v_counter integer;
  v_prefix text;
  v_document_no text;
  v_result public.prepack_transactions%rowtype;
begin
  if v_user_id is null then raise exception 'You must be signed in'; end if;

  select full_name into v_actor_name
  from public.profiles where id = v_user_id and is_active = true;
  if v_actor_name is null then
    raise exception 'Your account is inactive or profile is missing';
  end if;
  if p_transaction_type not in ('pack', 'ship', 'return') then
    raise exception 'Invalid prepack transaction type';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be greater than zero';
  end if;

  select * into v_product from public.products
  where id = p_product_id for update;
  if not found then raise exception 'Product not found'; end if;

  insert into public.prepack_inventory(product_id, quantity, external_quantity)
  values (p_product_id, 0, 0) on conflict (product_id) do nothing;

  select quantity, external_quantity
    into v_prepack_before, v_external_before
  from public.prepack_inventory where product_id = p_product_id for update;

  if p_transaction_type = 'pack' then
    if not v_product.is_active then raise exception 'Product is inactive'; end if;
    if p_deduct_central and v_product.quantity < p_quantity then
      raise exception 'Insufficient central stock. Available: %', v_product.quantity;
    end if;
    v_stock_after := v_product.quantity - case when p_deduct_central then p_quantity else 0 end;
    v_prepack_after := v_prepack_before + p_quantity;
    v_external_after := v_external_before + case when p_deduct_central then 0 else p_quantity end;
    v_prefix := 'PP';
  elsif p_transaction_type = 'ship' then
    if v_prepack_before < p_quantity then
      raise exception 'Insufficient prepack stock. Available: %', v_prepack_before;
    end if;
    v_external_used := least(v_external_before, p_quantity);
    v_external_after := v_external_before - v_external_used;
    v_stock_after := v_product.quantity;
    v_prepack_after := v_prepack_before - p_quantity;
    v_prefix := 'PS';
  else
    v_central_prepack := v_prepack_before - v_external_before;
    if v_central_prepack < p_quantity then
      raise exception 'Only central-source prepack stock can be returned. Available: %', v_central_prepack;
    end if;
    v_stock_after := v_product.quantity + p_quantity;
    v_prepack_after := v_prepack_before - p_quantity;
    v_external_after := v_external_before;
    v_prefix := 'PR';
  end if;

  insert into public.prepack_document_counters(counter_date, transaction_type, last_number)
  values (current_date, p_transaction_type, 1)
  on conflict (counter_date, transaction_type)
  do update set last_number = public.prepack_document_counters.last_number + 1
  returning last_number into v_counter;

  v_document_no := v_prefix || '-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(v_counter::text, 4, '0');

  update public.products set quantity = v_stock_after, updated_at = now()
  where id = p_product_id;
  update public.prepack_inventory
  set quantity = v_prepack_after, external_quantity = v_external_after, updated_at = now()
  where product_id = p_product_id;

  insert into public.prepack_transactions (
    document_no, product_id, transaction_type, quantity,
    prepack_before, prepack_after, stock_before, stock_after,
    actor_id, actor_name, note, central_stock_affected
  ) values (
    v_document_no, p_product_id, p_transaction_type, p_quantity,
    v_prepack_before, v_prepack_after, v_product.quantity, v_stock_after,
    v_user_id, v_actor_name,
    case
      when p_transaction_type = 'pack' and not p_deduct_central
        then trim('[ไม่ตัดสต็อกคลังกลาง] ' || coalesce(p_note, ''))
      else coalesce(p_note, '')
    end,
    case when p_transaction_type = 'pack' then p_deduct_central
         when p_transaction_type = 'return' then true
         else false end
  ) returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.process_prepack_transaction(uuid, text, integer, text, boolean) from public;
grant execute on function public.process_prepack_transaction(uuid, text, integer, text, boolean) to authenticated;
