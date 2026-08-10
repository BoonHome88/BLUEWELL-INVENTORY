-- BlueWell Inventory v3.8
-- Product barcodes and atomic offline issue imports.

alter table public.products
  add column if not exists barcode text;

update public.products
set barcode = sku
where barcode is null or length(trim(barcode)) = 0;

alter table public.products
  alter column barcode set not null;

create unique index if not exists products_barcode_unique_ci
  on public.products (upper(trim(barcode)));

create table if not exists public.offline_import_batches (
  id uuid primary key default gen_random_uuid(),
  batch_id text not null unique,
  source_filename text not null default '',
  row_count integer not null check (row_count > 0),
  total_quantity integer not null check (total_quantity > 0),
  imported_by uuid not null references public.profiles(id) on delete restrict,
  imported_by_name text not null,
  imported_at timestamptz not null default now()
);

create table if not exists public.offline_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id text not null references public.offline_import_batches(batch_id) on delete restrict,
  row_id text not null,
  barcode text not null,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  offline_operator text not null,
  offline_note text not null,
  scanned_at timestamptz,
  transaction_id uuid not null unique references public.stock_transactions(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (batch_id, row_id)
);

create index if not exists offline_import_rows_batch_idx
  on public.offline_import_rows(batch_id);
create index if not exists offline_import_rows_product_idx
  on public.offline_import_rows(product_id);

alter table public.offline_import_batches enable row level security;
alter table public.offline_import_rows enable row level security;

drop policy if exists "offline_batches_admin_read" on public.offline_import_batches;
create policy "offline_batches_admin_read"
on public.offline_import_batches for select
to authenticated
using (public.is_admin());

drop policy if exists "offline_rows_admin_read" on public.offline_import_rows;
create policy "offline_rows_admin_read"
on public.offline_import_rows for select
to authenticated
using (public.is_admin());

create or replace function public.import_offline_issue_batch(
  p_batch_id text,
  p_source_filename text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_actor_name text;
  v_row jsonb;
  v_product public.products%rowtype;
  v_transaction public.stock_transactions%rowtype;
  v_row_count integer;
  v_total integer := 0;
  v_row_id text;
  v_barcode text;
  v_quantity integer;
  v_operator text;
  v_note text;
  v_scanned_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'You must be signed in';
  end if;

  select full_name into v_actor_name
  from public.profiles
  where id = v_user_id and is_active = true and role = 'admin';

  if v_actor_name is null then
    raise exception 'Only an active administrator can import offline issues';
  end if;

  if p_batch_id is null or length(trim(p_batch_id)) = 0 then
    raise exception 'Missing offline batch id';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The import file has no rows';
  end if;

  if exists (
    select 1 from public.offline_import_batches
    where batch_id = trim(p_batch_id)
  ) then
    raise exception 'This offline issue file was already imported';
  end if;

  v_row_count := jsonb_array_length(p_rows);

  insert into public.offline_import_batches (
    batch_id, source_filename, row_count, total_quantity,
    imported_by, imported_by_name
  ) values (
    trim(p_batch_id), coalesce(p_source_filename, ''), v_row_count, 1,
    v_user_id, v_actor_name
  );

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_row_id := trim(coalesce(v_row->>'row_id', ''));
    v_barcode := upper(trim(coalesce(v_row->>'barcode', '')));
    v_quantity := nullif(v_row->>'quantity', '')::integer;
    v_operator := trim(coalesce(v_row->>'operator', ''));
    v_note := trim(coalesce(v_row->>'note', ''));
    v_scanned_at := nullif(v_row->>'scanned_at', '')::timestamptz;

    if v_row_id = '' or v_barcode = '' then
      raise exception 'A row is missing row id or barcode';
    end if;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Invalid quantity for barcode %', v_barcode;
    end if;
    if v_operator = '' or v_note = '' then
      raise exception 'Offline operator and note are required for barcode %', v_barcode;
    end if;

    select * into v_product
    from public.products
    where upper(trim(barcode)) = v_barcode and is_active = true;

    if not found then
      raise exception 'Product barcode % was not found or is inactive', v_barcode;
    end if;

    select * into v_transaction
    from public.process_stock_transaction(
      v_product.id,
      'issue',
      v_quantity,
      format(
        '[เบิกออฟไลน์ | ผู้เบิก: %s | เวลา: %s] %s',
        v_operator,
        coalesce(to_char(v_scanned_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI:SS'), '-'),
        v_note
      )
    );

    insert into public.offline_import_rows (
      batch_id, row_id, barcode, product_id, quantity,
      offline_operator, offline_note, scanned_at, transaction_id
    ) values (
      trim(p_batch_id), v_row_id, v_barcode, v_product.id, v_quantity,
      v_operator, v_note, v_scanned_at, v_transaction.id
    );

    v_total := v_total + v_quantity;
  end loop;

  update public.offline_import_batches
  set total_quantity = v_total
  where batch_id = trim(p_batch_id);

  return jsonb_build_object(
    'batch_id', trim(p_batch_id),
    'imported_count', v_row_count,
    'total_quantity', v_total
  );
end;
$$;

revoke all on public.offline_import_batches, public.offline_import_rows from public, anon;
grant select on public.offline_import_batches, public.offline_import_rows to authenticated;

revoke all on function public.import_offline_issue_batch(text, text, jsonb) from public;
grant execute on function public.import_offline_issue_batch(text, text, jsonb) to authenticated;
