-- BlueWell Inventory v3.8.1
-- Allow the existing admin correction RPC to remove an imported offline issue.
-- The import batch header remains, so the same file is still protected from re-import.

alter table public.offline_import_rows
  drop constraint if exists offline_import_rows_transaction_id_fkey;

alter table public.offline_import_rows
  add constraint offline_import_rows_transaction_id_fkey
  foreign key (transaction_id)
  references public.stock_transactions(id)
  on delete cascade;
