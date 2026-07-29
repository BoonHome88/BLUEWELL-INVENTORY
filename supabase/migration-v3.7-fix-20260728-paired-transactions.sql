-- BlueWell Inventory v3.7
-- Correct the paired 28 July 2026 restock/issue entry:
-- 3,210 was mistakenly entered as cases and converted to 38,520 pieces.
--
-- Corrects both sides together, so the current product balance remains unchanged.

do $$
declare
  v_restock public.stock_transactions%rowtype;
  v_issue public.stock_transactions%rowtype;
  v_wrong_quantity integer := 38520;
  v_correct_quantity integer := 3210;
  v_difference integer := 35310;
  v_issue_matches integer;
  v_min_shifted_balance integer;
begin
  select * into v_restock
  from public.stock_transactions
  where document_no = 'RC-20260728-00002'
  for update;

  if not found then
    raise exception 'Restock document RC-20260728-00002 was not found';
  end if;

  -- Make this migration safe to run again after the correction is complete.
  if v_restock.quantity = v_correct_quantity then
    if exists (
      select 1
      from public.stock_transactions
      where document_no in ('BK-20260728-00003', 'BK-20260728-00006')
        and product_id = v_restock.product_id
        and quantity = v_correct_quantity
    ) then
      raise notice 'The paired transactions were already corrected';
      return;
    end if;
  end if;

  if v_restock.transaction_type <> 'restock'
     or v_restock.quantity <> v_wrong_quantity then
    raise exception
      'RC-20260728-00002 does not match the expected restock quantity of 38,520 pieces';
  end if;

  select count(*) into v_issue_matches
  from public.stock_transactions
  where document_no in ('BK-20260728-00003', 'BK-20260728-00006')
    and product_id = v_restock.product_id
    and transaction_type = 'issue'
    and quantity = v_wrong_quantity;

  if v_issue_matches <> 1 then
    raise exception
      'Expected exactly one matching 38,520-piece issue document, found %',
      v_issue_matches;
  end if;

  select * into v_issue
  from public.stock_transactions
  where document_no in ('BK-20260728-00003', 'BK-20260728-00006')
    and product_id = v_restock.product_id
    and transaction_type = 'issue'
    and quantity = v_wrong_quantity
  for update;

  if v_issue.created_at <= v_restock.created_at then
    raise exception 'The matching issue document must occur after the restock document';
  end if;

  -- Every balance between the incorrect restock and its matching issue
  -- must be shifted down by 35,310 pieces.
  select min(least(
    balance_before - v_difference,
    balance_after - v_difference
  ))
  into v_min_shifted_balance
  from public.stock_transactions
  where product_id = v_restock.product_id
    and created_at > v_restock.created_at
    and created_at < v_issue.created_at;

  if v_restock.balance_after - v_difference < 0
     or v_issue.balance_before - v_difference < 0
     or (v_min_shifted_balance is not null and v_min_shifted_balance < 0) then
    raise exception
      'The paired correction would create a negative intermediate balance';
  end if;

  update public.stock_transactions
  set
    quantity = v_correct_quantity,
    balance_after = balance_after - v_difference,
    note = trim(concat(
      note,
      case when note = '' then '' else ' | ' end,
      'แก้ไขโดยผู้ดูแลระบบ: 3,210 ชิ้น (เดิมระบบคูณ 12 เป็น 38,520 ชิ้น)'
    ))
  where id = v_restock.id;

  update public.stock_transactions
  set
    balance_before = balance_before - v_difference,
    balance_after = balance_after - v_difference
  where product_id = v_restock.product_id
    and created_at > v_restock.created_at
    and created_at < v_issue.created_at;

  update public.stock_transactions
  set
    quantity = v_correct_quantity,
    balance_before = balance_before - v_difference,
    note = trim(concat(
      note,
      case when note = '' then '' else ' | ' end,
      'แก้ไขโดยผู้ดูแลระบบ: 3,210 ชิ้น (เดิมระบบคูณ 12 เป็น 38,520 ชิ้น)'
    ))
  where id = v_issue.id;

  raise notice
    'Corrected % and % from 38,520 to 3,210 pieces; current stock remains unchanged',
    v_restock.document_no,
    v_issue.document_no;
end;
$$;

