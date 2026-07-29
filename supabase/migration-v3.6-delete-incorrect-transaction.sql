-- BlueWell Inventory v3.6
-- Permanently remove an incorrect stock transaction and reverse its effect.

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
  if v_user_id is null then
    raise exception 'You must be signed in';
  end if;

  if not public.is_admin() then
    raise exception 'Only administrators can delete incorrect transactions';
  end if;

  select * into v_transaction
  from public.stock_transactions
  where id = p_transaction_id
  for update;

  if not found then
    raise exception 'Transaction not found';
  end if;

  select * into v_product
  from public.products
  where id = v_transaction.product_id
  for update;

  if not found then
    raise exception 'Product not found';
  end if;

  v_delta := case
    when v_transaction.transaction_type = 'issue'
      then v_transaction.quantity
    else -v_transaction.quantity
  end;

  v_new_quantity := v_product.quantity + v_delta;

  if v_new_quantity < 0 then
    raise exception
      'Cannot delete this transaction because current stock would become negative (%)',
      v_new_quantity;
  end if;

  select min(least(balance_before + v_delta, balance_after + v_delta))
  into v_min_balance
  from public.stock_transactions
  where product_id = v_transaction.product_id
    and created_at > v_transaction.created_at;

  if v_min_balance is not null and v_min_balance < 0 then
    raise exception
      'Cannot delete this transaction because a later balance would become negative (%)',
      v_min_balance;
  end if;

  update public.stock_transactions
  set
    balance_before = balance_before + v_delta,
    balance_after = balance_after + v_delta
  where product_id = v_transaction.product_id
    and created_at > v_transaction.created_at;

  update public.products
  set quantity = v_new_quantity, updated_at = now()
  where id = v_transaction.product_id;

  delete from public.stock_transactions
  where id = v_transaction.id;

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

